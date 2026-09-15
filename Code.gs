/**
 * Drive with Shun — booking backend (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script inside Shun's PRIVATE
 * Google Sheet, then follow README.md, Part 1.
 *
 * What it does
 *   GET  ?action=availability   returns open start times and the current rate (no names or numbers)
 *   POST {action:"book", ...}   checks the slot is still free, saves the booking,
 *                               alerts Shun's phone and emails the student
 *   GET/POST ?action=admin_*    powers admin.html (README Part 3). Requires ADMIN_KEY below.
 *
 * Shun manages everything from the Sheet, or from admin.html:
 *   Bookings  one row per lesson. Set Status to "Cancelled" to free the time.
 *   Hours     weekly working hours. Leave a day blank to close it.
 *   Time Off  block a day, a range of days or part of a day.
 *   Settings  the hourly rate and the first-lesson discount percentage.
 * ---------------------------------------------------------------------------
 */

// ============================== SETTINGS ===================================
const SETTINGS = {
  BUSINESS_NAME: 'Drive with Shun',
  INSTRUCTOR_NAME: 'Shun',
  OWNER_EMAIL: '50dollarrental@gmail.com',              // where alerts go. Blank = the Google account that owns this script
  RATE_PER_HOUR: 25,            // starting rate. Change it any time from the Settings tab or admin.html, no redeploy needed
  FIRST_LESSON_DISCOUNT_PERCENT: 50, // starting first-lesson discount. Same as above, editable later
  SLOT_MINUTES: 60,             // keep in sync with script.js
  ALLOWED_HOURS: [1, 2],        // lesson lengths students can book
  MIN_NOTICE_HOURS: 12,         // no bookings sooner than this
  MAX_DAYS_AHEAD: 60,           // no bookings further out than this
  MAX_UPCOMING_PER_PERSON: 3,   // stops one phone number from grabbing every slot
  SEND_CUSTOMER_EMAIL: true,    // email the student a confirmation
  ADMIN_KEY: 'Hond@civic2015',                // set a private password here before using admin.html (README Part 3)

  // ---- Instant alerts to Shun's phone (README Part 2). Blank = turned off ----
  EMAIL_ALERTS: true,           // Gmail app push notification
  TELEGRAM_BOT_TOKEN: '',       // e.g. '123456789:AAH...'
  TELEGRAM_CHAT_ID: '',         // e.g. '987654321'
  PUSHOVER_APP_TOKEN: '',
  PUSHOVER_USER_KEY: '',
  WEBHOOK_URL: '',              // any service that accepts a JSON POST (Zapier, Make, Slack, Discord)
};
// ===========================================================================

const SHEET_BOOKINGS = 'Bookings';
const SHEET_HOURS = 'Hours';
const SHEET_TIME_OFF = 'Time Off';
const SHEET_SETTINGS = 'Settings';

const STATUSES = ['Booked', 'Started', 'In progress', 'Completed', 'Cancelled', 'No-show'];

const BOOKING_HEADERS = ['Booking ID', 'Booked at', 'Lesson date', 'Start', 'End', 'Hours', 'Status',
  'Name', 'Phone', 'Email', 'Experience', 'Car', 'Meeting spot', 'Notes', 'Lesson price'];
const COL = { DATE: 2, START: 3, END: 4, HOURS: 5, STATUS: 6, PHONE: 8, EMAIL: 9 }; // 0-based indexes

const EXPERIENCE = {
  never: 'Has never driven',
  some: 'Has practiced a little',
  local: 'Fine on quiet roads, nervous in traffic',
  experienced: 'Drives already, wants highway or city practice',
};
const CARS = {
  own: "Student's own car",
  instructor: "Instructor's car (student covers fuel)",
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ============================ SHEET MENU ================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Driving school')
    .addItem('Set up sheets', 'setup')
    .addItem('Send a test alert', 'testAlerts')
    .addItem('Show open times (next 7 days)', 'testAvailability')
    .addToUi();
}

/**
 * Run once from the Apps Script editor. Creates the three tabs, adds headers
 * and default hours, and asks for the permissions the script needs.
 * Safe to run again: it never deletes bookings.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  const bookings = ensureSheet_(ss, SHEET_BOOKINGS, BOOKING_HEADERS);
  bookings.getRange('C:E').setNumberFormat('@');   // dates and times stored as plain text
  bookings.getRange('I:I').setNumberFormat('@');   // phone numbers stored as plain text
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUSES, true)
    .setAllowInvalid(true)
    .build();
  bookings.getRange(2, COL.STATUS + 1, bookings.getMaxRows() - 1, 1).setDataValidation(statusRule);
  bookings.getRange('G1').setNote('Change a lesson to "Cancelled" to free up that time on the website.');

  const hours = ensureSheet_(ss, SHEET_HOURS, ['Day', 'Open', 'Close']);
  hours.getRange('B:C').setNumberFormat('@');
  if (hours.getLastRow() < 2) {
    hours.getRange(2, 1, 7, 3).setValues([
      ['Monday', '09:00', '17:00'],
      ['Tuesday', '09:00', '17:00'],
      ['Wednesday', '09:00', '17:00'],
      ['Thursday', '09:00', '17:00'],
      ['Friday', '09:00', '17:00'],
      ['Saturday', '09:00', '13:00'],
      ['Sunday', '', ''],
    ]);
  }
  hours.getRange('A1').setNote('Use 24-hour times like 09:00 and 17:30. Leave Open and Close blank to close that day. Add a second row for the same day for split shifts (e.g. Monday 09:00-12:00 and Monday 15:00-19:00).');

  const off = ensureSheet_(ss, SHEET_TIME_OFF, ['Date', 'Through date', 'From', 'To', 'Note']);
  off.getRange('A:D').setNumberFormat('@');
  off.getRange('A1').setNote('Type dates like 2026-10-05. Leave From/To blank to block the whole day. Fill "Through date" to block several days in a row.');

  const settings = ensureSheet_(ss, SHEET_SETTINGS, ['Setting', 'Value']);
  if (settings.getLastRow() < 2) {
    settings.getRange(2, 1, 2, 2).setValues([
      ['Rate per hour', SETTINGS.RATE_PER_HOUR],
      ['First-lesson discount percent', SETTINGS.FIRST_LESSON_DISCOUNT_PERCENT],
    ]);
  }
  settings.getRange('A1').setNote('Change these here, or from the Rates panel on admin.html. The website picks up a change within a minute, no redeploy needed.');

  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  console.log('Setup complete. Spreadsheet time zone: ' + ss.getSpreadsheetTimeZone() +
    '. If that is not Shun\'s local time zone, fix it in File > Settings.');
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#0B5D3B')
      .setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Reads the Settings tab. Falls back to the SETTINGS constants if a row is missing (e.g. before setup() has run again). */
function getSettings_(ss) {
  const out = { ratePerHour: SETTINGS.RATE_PER_HOUR, discountPercent: SETTINGS.FIRST_LESSON_DISCOUNT_PERCENT };
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return out;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  rows.forEach(function (row) {
    const key = String(row[0] || '').trim().toLowerCase();
    const value = Number(row[1]);
    if (!isFinite(value)) return;
    if (key === 'rate per hour' && value > 0) out.ratePerHour = value;
    if (key === 'first-lesson discount percent' && value >= 0 && value <= 100) out.discountPercent = value;
  });
  return out;
}

/** Writes any of {ratePerHour, discountPercent} to the Settings tab, creating it if needed. */
function setSettings_(ss, patch) {
  const sheet = ensureSheet_(ss, SHEET_SETTINGS, ['Setting', 'Value']);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 2, 2).setValues([
      ['Rate per hour', SETTINGS.RATE_PER_HOUR],
      ['First-lesson discount percent', SETTINGS.FIRST_LESSON_DISCOUNT_PERCENT],
    ]);
  }
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  rows.forEach(function (row, i) {
    const key = String(row[0] || '').trim().toLowerCase();
    if (key === 'rate per hour' && patch.ratePerHour !== undefined) sheet.getRange(i + 2, 2).setValue(patch.ratePerHour);
    if (key === 'first-lesson discount percent' && patch.discountPercent !== undefined) sheet.getRange(i + 2, 2).setValue(patch.discountPercent);
  });
}

/* ============================ WEB APP ===================================== */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'availability';

    if (action === 'ping') return json_({ ok: true, business: SETTINGS.BUSINESS_NAME });

    if (action === 'availability') {
      const ss = ss_();
      const tz = ss.getSpreadsheetTimeZone();
      const today = todayKey_(tz);
      const lastDay = addDaysKey_(today, SETTINGS.MAX_DAYS_AHEAD);
      let from = isDateKey_(p.from) ? p.from : today;
      let to = isDateKey_(p.to) ? p.to : addDaysKey_(from, 29);
      if (from < today) from = today;
      if (to > lastDay) to = lastDay;
      if (to < from) to = from;

      const settings = getSettings_(ss);
      const days = getAvailability_(ss, tz, from, to, readBookings_(ss, tz));
      return json_({
        ok: true, timezone: tz, slotMinutes: SETTINGS.SLOT_MINUTES, from: from, to: to, days: days,
        ratePerHour: settings.ratePerHour, discountPercent: settings.discountPercent,
      });
    }

    if (action === 'admin_bookings') {
      if (!isAdmin_(p.key)) return json_({ ok: false, error: 'FORBIDDEN', message: 'Wrong admin key.' });
      const ss = ss_();
      const tz = ss.getSpreadsheetTimeZone();
      return json_({ ok: true, statuses: STATUSES, settings: getSettings_(ss), bookings: readAllBookings_(ss, tz) });
    }

    return json_({ ok: false, error: 'UNKNOWN_ACTION', message: 'Unknown request.' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'SERVER_ERROR', message: 'The booking system had a problem loading times. Try again in a minute.' });
  }
}

function doPost(e) {
  try {
    let data;
    try {
      data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (parseErr) {
      return json_({ ok: false, error: 'BAD_REQUEST', message: 'The booking request could not be read. Refresh the page and try again.' });
    }

    if (data.action === 'admin_update_status') return adminUpdateStatus_(data);
    if (data.action === 'admin_set_rates') return adminSetRates_(data);
    if (data.action === 'admin_add_timeoff') return adminAddTimeOff_(data);

    if (data.action !== 'book') return json_({ ok: false, error: 'UNKNOWN_ACTION', message: 'Unknown request.' });

    // Spam trap: bots fill in the hidden "website" field. Pretend it worked, save nothing.
    if (data.website) return json_({ ok: true, bookingId: 'RECEIVED' });

    const ss = ss_();
    const tz = ss.getSpreadsheetTimeZone();
    const settings = getSettings_(ss);
    const checked = validate_(data, tz, settings.ratePerHour);
    if (checked.error) return json_({ ok: false, error: 'INVALID', message: checked.error });
    const b = checked.booking;

    // Lock so two people can't grab the same slot at the same moment
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (lockErr) {
      return json_({ ok: false, error: 'BUSY', message: 'Several people are booking right now. Wait a few seconds and try again.' });
    }

    let bookingId;
    try {
      const bookings = readBookings_(ss, tz);

      const today = todayKey_(tz);
      const upcoming = bookings.filter(function (x) { return x.phone === b.phoneDigits && x.date >= today; }).length;
      if (upcoming >= SETTINGS.MAX_UPCOMING_PER_PERSON) {
        return json_({ ok: false, error: 'LIMIT', message: 'You already have ' + upcoming + ' upcoming lessons booked. Contact ' + SETTINGS.INSTRUCTOR_NAME + ' to book more.' });
      }

      const free = getAvailability_(ss, tz, b.date, b.date, bookings)[b.date] || [];
      const slotsNeeded = Math.round((b.hours * 60) / SETTINGS.SLOT_MINUTES);
      for (let i = 0; i < slotsNeeded; i++) {
        if (free.indexOf(hhmm_(b.startMin + i * SETTINGS.SLOT_MINUTES)) === -1) {
          return json_({ ok: false, error: 'SLOT_TAKEN', message: 'That time was just booked by someone else. Pick another time.' });
        }
      }

      if (settings.discountPercent > 0 && !hasPriorBooking_(ss, b.phoneDigits, b.email)) {
        b.price = Math.round(b.price * (100 - settings.discountPercent)) / 100;
        b.discountApplied = true;
      }

      bookingId = makeId_(tz);
      ss.getSheetByName(SHEET_BOOKINGS).appendRow([
        bookingId,
        Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'),
        b.date,
        b.start,
        b.end,
        b.hours,
        'Booked',
        safe_(b.name),
        safe_(b.phone),
        safe_(b.email),
        EXPERIENCE[b.experience],
        CARS[b.vehicle],
        safe_(b.meetingSpot),
        safe_(b.notes),
        b.price,
      ]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    // Alerts run after the lock is released. A failed alert never cancels a booking.
    alertOwner_(b, bookingId, ss);
    if (SETTINGS.SEND_CUSTOMER_EMAIL) {
      try { emailCustomer_(b, bookingId); } catch (mailErr) { console.error('Customer email failed: ' + mailErr); }
    }

    return json_({ ok: true, bookingId: bookingId, date: b.date, start: b.start, end: b.end, hours: b.hours, price: b.price, discountApplied: !!b.discountApplied });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'SERVER_ERROR', message: 'The booking didn\'t go through because of a problem on our side. Try again in a minute.' });
  }
}

/* ============================ AVAILABILITY ================================= */

/** Returns { "yyyy-MM-dd": ["09:00", "10:00", ...] } of free slot start times */
function getAvailability_(ss, tz, from, to, bookings) {
  const hours = readHours_(ss);
  const off = readTimeOff_(ss, tz);
  const busy = {};
  bookings.forEach(function (x) { (busy[x.date] = busy[x.date] || []).push([x.start, x.end]); });

  const earliest = Utilities.formatDate(new Date(Date.now() + SETTINGS.MIN_NOTICE_HOURS * 3600000), tz, 'yyyy-MM-dd HH:mm');
  const step = SETTINGS.SLOT_MINUTES;
  const days = {};
  let guard = 0;

  for (let key = from; key <= to && guard < 120; key = addDaysKey_(key, 1), guard++) {
    const list = [];
    (hours[weekday_(key)] || []).forEach(function (shift) {
      for (let m = shift[0]; m + step <= shift[1]; m += step) {
        if (key + ' ' + hhmm_(m) < earliest) continue;
        if (overlaps_(off[key], m, m + step) || overlaps_(busy[key], m, m + step)) continue;
        list.push(hhmm_(m));
      }
    });
    days[key] = list.sort();
  }
  return days;
}

/** Hours tab -> { weekdayIndex: [[openMin, closeMin], ...] } */
function readHours_(ss) {
  const sheet = ss.getSheetByName(SHEET_HOURS);
  const result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const shortNames = DAY_NAMES.map(function (d) { return d.slice(0, 3).toLowerCase(); });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getDisplayValues();
  rows.forEach(function (r) {
    const day = shortNames.indexOf(String(r[0]).trim().slice(0, 3).toLowerCase());
    const open = minutes_(r[1]);
    const close = minutes_(r[2]);
    if (day === -1 || open === null || close === null || close <= open) return;
    (result[day] = result[day] || []).push([open, close]);
  });
  return result;
}

/** Time Off tab -> { "yyyy-MM-dd": [[fromMin, toMin], ...] } */
function readTimeOff_(ss, tz) {
  const sheet = ss.getSheetByName(SHEET_TIME_OFF);
  const result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4);
  const values = range.getValues();
  const display = range.getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    const first = dateKey_(values[i][0], tz);
    if (!first) continue;
    const last = dateKey_(values[i][1], tz) || first;
    const fromMin = minutes_(display[i][2]);
    const toMin = minutes_(display[i][3]);
    const block = [fromMin === null ? 0 : fromMin, toMin === null ? 1440 : toMin];
    let guard = 0;
    for (let key = first; key <= last && guard < 366; key = addDaysKey_(key, 1), guard++) {
      (result[key] = result[key] || []).push(block);
    }
  }
  return result;
}

/** Bookings tab -> active (not cancelled) lessons */
function readBookings_(ss, tz) {
  const sheet = ss.getSheetByName(SHEET_BOOKINGS);
  if (!sheet) throw new Error('The "Bookings" tab is missing. Run setup() from the Apps Script editor.');
  const count = sheet.getLastRow() - 1;
  if (count < 1) return [];
  const range = sheet.getRange(2, 1, count, BOOKING_HEADERS.length);
  const values = range.getValues();
  const display = range.getDisplayValues();
  const list = [];
  for (let i = 0; i < count; i++) {
    const status = String(values[i][COL.STATUS]).trim().toLowerCase();
    if (status === 'cancelled' || status === 'canceled') continue;
    const date = dateKey_(values[i][COL.DATE], tz);
    const start = minutes_(display[i][COL.START]);
    if (!date || start === null) continue;
    let end = minutes_(display[i][COL.END]);
    const hrs = Number(values[i][COL.HOURS]);
    if (end === null || end <= start) end = start + (hrs > 0 ? hrs * 60 : SETTINGS.SLOT_MINUTES);
    list.push({ date: date, start: start, end: end, phone: String(values[i][COL.PHONE]).replace(/\D/g, '') });
  }
  return list;
}

/* ============================ VALIDATION ================================== */

function validate_(d, tz, ratePerHour) {
  const clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max);
  };
  const name = clean(d.name, 80).replace(/\s+/g, ' ');
  const phone = clean(d.phone, 30);
  const phoneDigits = phone.replace(/\D/g, '');
  const email = clean(d.email, 120).toLowerCase();
  const meetingSpot = clean(d.meetingSpot, 160).replace(/\s+/g, ' ');
  const notes = clean(d.notes, 600);
  const date = String(d.date || '');
  const startMin = minutes_(String(d.time || ''));
  const hours = Number(d.duration);
  const today = todayKey_(tz);

  if (name.length < 2) return { error: 'Enter your full name.' };
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return { error: 'Enter a phone number, including the area code.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Enter a valid email address.' };
  if (!EXPERIENCE[d.experience]) return { error: 'Choose the option closest to your driving experience.' };
  if (!CARS[d.vehicle]) return { error: 'Choose which car you\'ll drive.' };
  if (d.permit !== true) return { error: 'You need a valid learner\'s permit to book a lesson.' };
  if (SETTINGS.ALLOWED_HOURS.indexOf(hours) === -1) return { error: 'Choose a lesson length.' };
  if (!isDateKey_(date) || date < today || date > addDaysKey_(today, SETTINGS.MAX_DAYS_AHEAD)) {
    return { error: 'Pick a date from the calendar.' };
  }
  if (startMin === null) return { error: 'Pick a start time from the list.' };

  return {
    booking: {
      name: name,
      phone: phone,
      phoneDigits: phoneDigits,
      email: email,
      meetingSpot: meetingSpot,
      notes: notes,
      date: date,
      startMin: startMin,
      hours: hours,
      start: hhmm_(startMin),
      end: hhmm_(startMin + hours * 60),
      experience: d.experience,
      vehicle: d.vehicle,
      price: hours * ratePerHour,
    },
  };
}

/** Stops text that starts with = + - @ from being treated as a spreadsheet formula */
function safe_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

/* ============================ ADMIN ========================================
   Powers admin.html. Every admin request must carry the right "key" (README
   Part 3). While SETTINGS.ADMIN_KEY is blank, every admin request is refused.
   ========================================================================== */

function isAdmin_(key) {
  return !!SETTINGS.ADMIN_KEY && String(key || '') === SETTINGS.ADMIN_KEY;
}

/** Every booking (any status), most recent lesson date first, for the admin page. */
function readAllBookings_(ss, tz) {
  const sheet = ss.getSheetByName(SHEET_BOOKINGS);
  if (!sheet) return [];
  const count = sheet.getLastRow() - 1;
  if (count < 1) return [];
  const display = sheet.getRange(2, 1, count, BOOKING_HEADERS.length).getDisplayValues();
  const list = display.map(function (row) {
    return {
      bookingId: row[0], bookedAt: row[1], date: row[2], start: row[3], end: row[4],
      hours: Number(row[5]) || 0, status: row[6], name: row[7], phone: row[8], email: row[9],
      experience: row[10], car: row[11], meetingSpot: row[12], notes: row[13], price: Number(row[14]) || 0,
    };
  });
  list.sort(function (a, b) { return a.date === b.date ? a.start.localeCompare(b.start) : b.date.localeCompare(a.date); });
  return list;
}

/** True if this phone or email already has a booking on file (any status). Used for the first-lesson discount. */
function hasPriorBooking_(ss, phoneDigits, email) {
  const sheet = ss.getSheetByName(SHEET_BOOKINGS);
  const count = sheet.getLastRow() - 1;
  if (count < 1) return false;
  const values = sheet.getRange(2, 1, count, BOOKING_HEADERS.length).getValues();
  const emailLower = String(email || '').toLowerCase();
  return values.some(function (row) {
    const rowPhone = String(row[COL.PHONE]).replace(/\D/g, '');
    const rowEmail = String(row[COL.EMAIL]).toLowerCase();
    return (phoneDigits && rowPhone === phoneDigits) || (emailLower && rowEmail === emailLower);
  });
}

function adminUpdateStatus_(data) {
  if (!isAdmin_(data.key)) return json_({ ok: false, error: 'FORBIDDEN', message: 'Wrong admin key.' });
  const status = String(data.status || '');
  if (STATUSES.indexOf(status) === -1) return json_({ ok: false, error: 'INVALID', message: 'Not a valid status.' });
  const ss = ss_();
  const sheet = ss.getSheetByName(SHEET_BOOKINGS);
  const count = sheet.getLastRow() - 1;
  if (count < 1) return json_({ ok: false, error: 'NOT_FOUND', message: 'That booking was not found.' });
  const ids = sheet.getRange(2, 1, count, 1).getValues();
  for (let i = 0; i < count; i++) {
    if (ids[i][0] === data.bookingId) {
      sheet.getRange(i + 2, COL.STATUS + 1).setValue(status);
      return json_({ ok: true });
    }
  }
  return json_({ ok: false, error: 'NOT_FOUND', message: 'That booking was not found.' });
}

function adminSetRates_(data) {
  if (!isAdmin_(data.key)) return json_({ ok: false, error: 'FORBIDDEN', message: 'Wrong admin key.' });
  const rate = Number(data.ratePerHour);
  const discount = Number(data.discountPercent);
  const patch = {};
  if (isFinite(rate) && rate > 0) patch.ratePerHour = rate;
  if (isFinite(discount) && discount >= 0 && discount <= 100) patch.discountPercent = discount;
  if (!('ratePerHour' in patch) && !('discountPercent' in patch)) {
    return json_({ ok: false, error: 'INVALID', message: 'Enter a rate above 0 and a discount between 0 and 100.' });
  }
  const ss = ss_();
  setSettings_(ss, patch);
  return json_({ ok: true, settings: getSettings_(ss) });
}

function adminAddTimeOff_(data) {
  if (!isAdmin_(data.key)) return json_({ ok: false, error: 'FORBIDDEN', message: 'Wrong admin key.' });
  const date = String(data.date || '');
  if (!isDateKey_(date)) return json_({ ok: false, error: 'INVALID', message: 'Pick a date.' });
  const through = isDateKey_(data.throughDate) ? data.throughDate : '';
  const from = String(data.from || '').trim();
  const to = String(data.to || '').trim();
  const note = String(data.note || '').slice(0, 200);
  const ss = ss_();
  const sheet = ensureSheet_(ss, SHEET_TIME_OFF, ['Date', 'Through date', 'From', 'To', 'Note']);
  sheet.appendRow([date, through, from, to, note]);
  return json_({ ok: true });
}

/* ============================ ALERTS ====================================== */

function alertOwner_(b, bookingId, ss) {
  const text = alertText_(b, bookingId);
  const results = [];
  if (SETTINGS.EMAIL_ALERTS) {
    results.push(tryAlert_('Email', function () { emailOwner_(b, bookingId, text, ss); }));
  }
  if (SETTINGS.TELEGRAM_BOT_TOKEN && SETTINGS.TELEGRAM_CHAT_ID) {
    results.push(tryAlert_('Telegram', function () { sendTelegram_(text); }));
  }
  if (SETTINGS.PUSHOVER_APP_TOKEN && SETTINGS.PUSHOVER_USER_KEY) {
    results.push(tryAlert_('Pushover', function () { sendPushover_(text, ss); }));
  }
  if (SETTINGS.WEBHOOK_URL) {
    results.push(tryAlert_('Webhook', function () { sendWebhook_(b, bookingId, text); }));
  }
  return results;
}

function tryAlert_(label, fn) {
  try {
    fn();
    return label + ': sent';
  } catch (err) {
    console.error(label + ' alert failed: ' + err);
    return label + ': FAILED (' + err.message + ')';
  }
}

function alertText_(b, bookingId) {
  const lines = [
    'New driving lesson booked',
    prettyDate_(b.date) + ', ' + prettyTime_(b.startMin) + ' \u2013 ' + prettyTime_(b.startMin + b.hours * 60) + ' (' + b.hours + (b.hours === 1 ? ' hour)' : ' hours)'),
    '',
    'Name: ' + b.name,
    'Phone: ' + b.phone,
    'Email: ' + b.email,
    'Experience: ' + EXPERIENCE[b.experience],
    'Car: ' + CARS[b.vehicle],
    'Meeting spot: ' + (b.meetingSpot || 'Not given'),
  ];
  if (b.notes) lines.push('Notes: ' + b.notes);
  lines.push('', 'Due on lesson day: ' + money_(b.price) + (b.vehicle === 'instructor' ? ' + fuel' : '') +
    (b.discountApplied ? ' (first-lesson discount already applied)' : ''), 'Ref: ' + bookingId);
  return lines.join('\n');
}

function emailOwner_(b, bookingId, text, ss) {
  MailApp.sendEmail({
    to: ownerEmail_(),
    subject: 'New lesson: ' + prettyDate_(b.date) + ', ' + prettyTime_(b.startMin) + ' \u2013 ' + b.name,
    body: text + '\n\nOpen the schedule: ' + ss.getUrl(),
    name: SETTINGS.BUSINESS_NAME + ' bookings',
    replyTo: b.email,
  });
}

function sendTelegram_(text) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + SETTINGS.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ chat_id: SETTINGS.TELEGRAM_CHAT_ID, text: text, disable_web_page_preview: true }),
  });
  if (res.getResponseCode() !== 200) throw new Error(res.getContentText());
}

function sendPushover_(text, ss) {
  const res = UrlFetchApp.fetch('https://api.pushover.net/1/messages.json', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      token: SETTINGS.PUSHOVER_APP_TOKEN,
      user: SETTINGS.PUSHOVER_USER_KEY,
      title: 'New lesson booked',
      message: text,
      url: ss.getUrl(),
      url_title: 'Open the schedule',
    },
  });
  if (res.getResponseCode() !== 200) throw new Error(res.getContentText());
}

function sendWebhook_(b, bookingId, text) {
  const res = UrlFetchApp.fetch(SETTINGS.WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      event: 'booking.created',
      text: text,      // Slack and most tools
      content: text,   // Discord
      booking: {
        id: bookingId, date: b.date, start: b.start, end: b.end, hours: b.hours,
        name: b.name, phone: b.phone, email: b.email,
        experience: EXPERIENCE[b.experience], car: CARS[b.vehicle],
        meetingSpot: b.meetingSpot, notes: b.notes, price: b.price,
      },
    }),
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code + ': ' + res.getContentText());
}

function emailCustomer_(b, bookingId) {
  const first = b.name.split(' ')[0];
  const body = [
    'Hi ' + first + ',',
    '',
    'Your driving lesson with ' + SETTINGS.INSTRUCTOR_NAME + ' is booked.',
    '',
    'When: ' + prettyDate_(b.date) + ', ' + prettyTime_(b.startMin) + ' \u2013 ' + prettyTime_(b.startMin + b.hours * 60),
    'Length: ' + b.hours + (b.hours === 1 ? ' hour' : ' hours'),
    'Car: ' + (b.vehicle === 'own' ? 'Your own car' : "The instructor's car"),
    'Meeting spot: ' + (b.meetingSpot || SETTINGS.INSTRUCTOR_NAME + ' will confirm this with you'),
    '',
    'Before your lesson:',
    '- Bring your valid learner\'s permit.',
    '- Payment of ' + money_(b.price) + ' is due on the day of your lesson' + (b.vehicle === 'instructor' ? ', plus the cost of fuel.' : '.') +
      (b.discountApplied ? ' Your first-lesson discount is already included in that price.' : ''),
    b.vehicle === 'own' ? '- Make sure your car is registered and insured.' : '',
    '',
    'Need to change something? Just reply to this email.',
    '',
    'See you on the road,',
    SETTINGS.INSTRUCTOR_NAME,
    '',
    'Booking reference: ' + bookingId,
  ].filter(function (line, i, arr) { return !(line === '' && arr[i - 1] === ''); }).join('\n');

  MailApp.sendEmail({
    to: b.email,
    subject: 'Your driving lesson is booked: ' + prettyDate_(b.date) + ', ' + prettyTime_(b.startMin),
    body: body,
    name: SETTINGS.BUSINESS_NAME,
    replyTo: ownerEmail_(),
  });
}

function ownerEmail_() {
  return SETTINGS.OWNER_EMAIL || Session.getEffectiveUser().getEmail();
}

/* ============================ TEST HELPERS ================================ */

/** Sends a fake booking alert to every channel you've turned on. Check the log for results. */
function testAlerts() {
  const ss = ss_();
  const tz = ss.getSpreadsheetTimeZone();
  const b = {
    name: 'Test Student', phone: '(555) 010-0000', email: ownerEmail_(),
    experience: 'never', vehicle: 'instructor', meetingSpot: 'Test meeting spot', notes: 'This is a test alert.',
    date: addDaysKey_(todayKey_(tz), 1), startMin: 600, hours: 1, start: '10:00', end: '11:00', price: SETTINGS.RATE_PER_HOUR,
  };
  const results = alertOwner_(b, 'TEST-0000', ss);
  console.log(results.length ? results.join('\n') : 'No alert channels are turned on in SETTINGS.');
}

/** Logs the open times for the next 7 days, exactly as the website will see them. */
function testAvailability() {
  const ss = ss_();
  const tz = ss.getSpreadsheetTimeZone();
  const today = todayKey_(tz);
  const days = getAvailability_(ss, tz, today, addDaysKey_(today, 6), readBookings_(ss, tz));
  Object.keys(days).forEach(function (k) {
    console.log(prettyDate_(k) + ': ' + (days[k].length ? days[k].join(', ') : 'no open times'));
  });
}

/* ============================ HELPERS ===================================== */

function ss_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() once from the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pad_(n) { return (Number(n) < 10 ? '0' : '') + Number(n); }
/** $25 for whole amounts, $12.50 when there are cents (e.g. after a discount) */
function money_(n) {
  const v = Number(n) || 0;
  return '$' + (v % 1 === 0 ? String(v) : v.toFixed(2));
}
function hhmm_(mins) { return pad_(Math.floor(mins / 60)) + ':' + pad_(mins % 60); }
function isDateKey_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function todayKey_(tz) { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); }

function keyToUtcDate_(key) {
  const p = key.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
}
function addDaysKey_(key, n) {
  const d = keyToUtcDate_(key);
  d.setUTCDate(d.getUTCDate() + n);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}
function weekday_(key) { return keyToUtcDate_(key).getUTCDay(); }
function prettyDate_(key) { return Utilities.formatDate(keyToUtcDate_(key), 'UTC', 'EEE, MMM d, yyyy'); }
function prettyTime_(mins) {
  const h = Math.floor(mins / 60) % 24;
  return (h % 12 || 12) + ':' + pad_(mins % 60) + (h >= 12 ? ' PM' : ' AM');
}

function overlaps_(ranges, start, end) {
  return !!ranges && ranges.some(function (r) { return start < r[1] && end > r[0]; });
}

/** Accepts a Date cell, "2026-10-05" or "10/5/2026". Returns "yyyy-MM-dd" or "". */
function dateKey_(value, tz) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad_(m[1]) + '-' + pad_(m[2]);
  return '';
}

/** Accepts "9:00", "09:00", "17:30", "9:00 AM", "5 pm", "9:00:00". Returns minutes after midnight or null. */
function minutes_(value) {
  const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a|p)?\.?\s*m?\.?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

function makeId_(tz) {
  return 'DS-' + Utilities.formatDate(new Date(), tz, 'yyMMdd') + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
}
