/* ==========================================================================
   Drive with Shun — script.js
   Modules:
     CONFIG       settings you edit (the Google Apps Script URL goes here)
     Utils        date, time and money helpers
     Nav          mobile hamburger menu
     Api          talks to the Google Apps Script backend
     DemoBackend  sample times, used until API_URL is filled in
     Booking      calendar, time slots, form validation and confirmation
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — the only section you need to edit
     ------------------------------------------------------------------------ */
  const CONFIG = {
    // Paste your Google Apps Script Web App URL here. It ends with /exec.
    // While this is empty, the calendar runs in preview mode with sample times.
    API_URL: 'https://github.com/Shunquinlan/Car-driving/blob/main/README.md',

    INSTRUCTOR_NAME: 'Shun',
    RATE_PER_HOUR: 25,        // keep in sync with RATE_PER_HOUR in Code.gs
    SLOT_MINUTES: 60,         // keep in sync with SLOT_MINUTES in Code.gs
    DAYS_AHEAD: 30,           // how many days of the calendar are bookable (≤ MAX_DAYS_AHEAD in Code.gs)
    REQUEST_TIMEOUT_MS: 20000,
  };

  /* ------------------------------------------------------------------------
     Utils
     ------------------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, '0');
  /** Date -> "YYYY-MM-DD" using the visitor's local calendar */
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /** "YYYY-MM-DD" -> local Date at midnight */
  const fromKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const toMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const fromMinutes = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  const addMinutes = (t, n) => fromMinutes(toMinutes(t) + n);
  /** "14:00" -> "2:00 PM" */
  const formatTime = (t) => {
    const mins = toMinutes(t);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h % 12 || 12}:${pad(m)} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;
  };
  const formatDate = (key, options = { weekday: 'long', month: 'long', day: 'numeric' }) =>
    fromKey(key).toLocaleDateString('en-US', options);
  const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
  const hoursLabel = (h) => `${h} hour${h === 1 ? '' : 's'}`;
  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollToEl = (el) => el && el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ------------------------------------------------------------------------
     Nav — hamburger menu for phones
     ------------------------------------------------------------------------ */
  const Nav = {
    init() {
      const toggle = document.querySelector('.nav-toggle');
      const menu = document.getElementById('site-menu');
      if (!toggle || !menu) return;

      const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
      const setOpen = (open) => {
        toggle.setAttribute('aria-expanded', String(open));
        menu.classList.toggle('is-open', open);
      };

      toggle.addEventListener('click', () => setOpen(!isOpen()));
      menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
      document.addEventListener('click', (e) => { if (isOpen() && !e.target.closest('.nav')) setOpen(false); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
      });
      window.matchMedia('(min-width: 900px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });

      document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    },
  };

  /* ------------------------------------------------------------------------
     Api — Google Apps Script backend
     GET  ?action=availability&from=YYYY-MM-DD&to=YYYY-MM-DD
          -> { ok, slotMinutes, days: { "YYYY-MM-DD": ["09:00", "10:00", ...] } }
     POST { action: "book", ...details }
          -> { ok, bookingId } or { ok: false, error, message }
     POST uses Content-Type text/plain so the browser skips the CORS preflight
     request, which Apps Script can't answer. The script still parses it as JSON.
     ------------------------------------------------------------------------ */
  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const Api = {
    isLive: () => Boolean(CONFIG.API_URL.trim()),

    availability(from, to) {
      if (!Api.isLive()) return DemoBackend.availability(from, to);
      const url = new URL(CONFIG.API_URL.trim());
      url.searchParams.set('action', 'availability');
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      url.searchParams.set('t', Date.now()); // skip any cached copy
      return Api.request(url.toString(), { method: 'GET' });
    },

    book(details) {
      if (!Api.isLive()) return DemoBackend.book(details);
      return Api.request(CONFIG.API_URL.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'book', ...details }),
      });
    },

    async request(url, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
      let data;
      try {
        const res = await fetch(url, { ...options, redirect: 'follow', signal: controller.signal });
        data = await res.json();
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new ApiError('TIMEOUT', 'The booking system took too long to answer. Check your connection and try again.');
        }
        throw new ApiError('NETWORK', "The booking system couldn't be reached. Check your connection and try again.");
      } finally {
        clearTimeout(timer);
      }
      if (!data || data.ok !== true) {
        throw new ApiError((data && data.error) || 'ERROR', (data && data.message) || 'The booking didn\u2019t go through. Try again in a minute.');
      }
      return data;
    },
  };

  /* ------------------------------------------------------------------------
     DemoBackend — sample times so the site works before Google Sheets is set up
     ------------------------------------------------------------------------ */
  const DemoBackend = {
    hours: { 0: null, 1: [9, 17], 2: [9, 17], 3: [9, 17], 4: [9, 17], 5: [9, 17], 6: [9, 13] }, // weekday -> [open, close]
    booked: new Set(),

    hash(str) {
      let h = 0;
      for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return h;
    },

    async availability(from, to) {
      await wait(450);
      const days = {};
      const earliest = Date.now() + 12 * 3600 * 1000; // 12 hours' notice
      for (let d = fromKey(from); toKey(d) <= to; d = addDays(d, 1)) {
        const key = toKey(d);
        const hours = this.hours[d.getDay()];
        const list = [];
        if (hours) {
          for (let hr = hours[0]; hr < hours[1]; hr++) {
            const t = `${pad(hr)}:00`;
            const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr).getTime();
            const takenBySample = this.hash(key + t) % 3 === 0;
            if (start >= earliest && !takenBySample && !this.booked.has(`${key} ${t}`)) list.push(t);
          }
        }
        days[key] = list;
      }
      return { ok: true, demo: true, slotMinutes: 60, days };
    },

    async book(details) {
      await wait(800);
      for (let i = 0; i < details.duration; i++) this.booked.add(`${details.date} ${addMinutes(details.time, i * 60)}`);
      return { ok: true, demo: true, bookingId: `PREVIEW-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
    },
  };

  /* ------------------------------------------------------------------------
     Booking — calendar, times, summary, form and confirmation
     ------------------------------------------------------------------------ */
  const Booking = {
    init() {
      const form = document.getElementById('booking-form');
      if (!form) return; // not on the home page

      const $ = (id) => document.getElementById(id);
      const el = {
        form,
        banner: $('preview-banner'),
        calGrid: $('cal-grid'),
        calTitle: $('cal-title'),
        prev: $('cal-prev'),
        next: $('cal-next'),
        schedule: $('step-schedule'),
        times: $('times'),
        timesTitle: $('times-title'),
        timesBody: $('times-body'),
        sLength: $('s-length'),
        sCar: $('s-car'),
        sDate: $('s-date'),
        sTime: $('s-time'),
        sTotal: $('s-total'),
        status: $('form-status'),
        submit: $('submit-btn'),
        confirmation: $('confirmation'),
      };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const state = {
        duration: 1,
        vehicle: 'own',
        rangeStart: toKey(today),
        rangeEnd: toKey(addDays(today, CONFIG.DAYS_AHEAD - 1)),
        month: new Date(today.getFullYear(), today.getMonth(), 1),
        days: {},
        slotMinutes: CONFIG.SLOT_MINUTES,
        loading: true,
        loadError: '',
        notice: '',
        date: null,
        time: null,
        submitting: false,
        triedSubmit: false,
      };

      if (!Api.isLive()) el.banner.hidden = false;

      /* ---------- Availability ---------- */

      // Start times that can fit the chosen lesson length on a given day
      const startsFor = (key) => {
        const free = state.days[key] || [];
        const set = new Set(free);
        const slotsNeeded = Math.max(1, Math.round((state.duration * 60) / state.slotMinutes));
        return free.filter((t) => {
          for (let i = 1; i < slotsNeeded; i++) {
            if (!set.has(addMinutes(t, i * state.slotMinutes))) return false;
          }
          return true;
        });
      };

      const firstOpenDay = () => {
        for (let d = fromKey(state.rangeStart); toKey(d) <= state.rangeEnd; d = addDays(d, 1)) {
          if (startsFor(toKey(d)).length) return toKey(d);
        }
        return null;
      };

      // Drop a picked date/time that no longer fits (after a length change or a refresh)
      const reconcileSelection = () => {
        if (!state.date) return;
        const starts = startsFor(state.date);
        if (!starts.length) {
          if (state.time) state.notice = `${formatDate(state.date)} has no room for a ${hoursLabel(state.duration)} lesson. Pick another date.`;
          state.date = null;
          state.time = null;
        } else if (state.time && !starts.includes(state.time)) {
          state.notice = `${formatTime(state.time)} doesn't have room for a ${hoursLabel(state.duration)} lesson. Pick another time.`;
          state.time = null;
        }
      };

      const loadAvailability = async ({ initial = false } = {}) => {
        state.loading = true;
        state.loadError = '';
        render();
        try {
          const data = await Api.availability(state.rangeStart, state.rangeEnd);
          state.days = data.days || {};
          state.slotMinutes = Number(data.slotMinutes) || CONFIG.SLOT_MINUTES;
        } catch (err) {
          state.loadError = err.message;
        }
        state.loading = false;
        reconcileSelection();

        // On first load, jump to the month of the first open day if this month is fully booked
        if (initial && !state.loadError) {
          const first = firstOpenDay();
          if (first) {
            const d = fromKey(first);
            const monthHasOpen = Object.keys(state.days).some((k) => {
              const kd = fromKey(k);
              return kd.getMonth() === state.month.getMonth() && kd.getFullYear() === state.month.getFullYear() && startsFor(k).length;
            });
            if (!monthHasOpen) state.month = new Date(d.getFullYear(), d.getMonth(), 1);
          }
        }
        render();
      };

      /* ---------- Rendering ---------- */

      const renderCalendar = () => {
        const y = state.month.getFullYear();
        const m = state.month.getMonth();
        const todayKey = toKey(today);
        el.calTitle.textContent = state.month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        el.calGrid.classList.toggle('is-loading', state.loading);

        const cells = [];
        const leading = new Date(y, m, 1).getDay();
        for (let i = 0; i < leading; i++) {
          const blank = document.createElement('span');
          blank.setAttribute('aria-hidden', 'true');
          cells.push(blank);
        }

        const daysInMonth = new Date(y, m + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
          const key = toKey(new Date(y, m, day));
          const inRange = key >= state.rangeStart && key <= state.rangeEnd;
          const count = inRange && !state.loading ? startsFor(key).length : 0;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cal-day';
          btn.textContent = String(day);
          btn.dataset.date = key;

          let label = formatDate(key);
          if (count) {
            btn.classList.add('is-open');
            label += `, ${count} open time${count === 1 ? '' : 's'}`;
          } else {
            btn.disabled = true;
            if (inRange && !state.loading) {
              btn.classList.add('is-full');
              label += ', no open times';
            } else {
              label += ', not available';
            }
          }
          if (key === todayKey) btn.classList.add('is-today');
          const selected = key === state.date;
          btn.classList.toggle('is-selected', selected);
          btn.setAttribute('aria-pressed', String(selected));
          btn.setAttribute('aria-label', label);
          cells.push(btn);
        }
        el.calGrid.replaceChildren(...cells);

        const firstMonth = fromKey(state.rangeStart);
        const lastMonth = fromKey(state.rangeEnd);
        el.prev.disabled = y < firstMonth.getFullYear() || (y === firstMonth.getFullYear() && m <= firstMonth.getMonth());
        el.next.disabled = y > lastMonth.getFullYear() || (y === lastMonth.getFullYear() && m >= lastMonth.getMonth());
      };

      const message = (text, className = 'times-empty') => {
        const p = document.createElement('p');
        p.className = className;
        p.textContent = text;
        return p;
      };

      const renderTimes = () => {
        const nodes = [];
        el.timesTitle.textContent = state.date ? formatDate(state.date) : 'Open times';

        if (state.notice) nodes.push(message(state.notice, 'times-notice'));

        if (state.loading) {
          nodes.push(message('Loading open times\u2026', 'times-empty is-loading'));
        } else if (state.loadError) {
          nodes.push(message(state.loadError, 'times-empty is-error'));
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'btn btn-outline times-retry';
          retry.textContent = 'Try again';
          retry.addEventListener('click', () => loadAvailability());
          nodes.push(retry);
        } else if (!state.date) {
          nodes.push(message(firstOpenDay()
            ? 'Pick a date to see open times.'
            : `There are no open times in the next ${CONFIG.DAYS_AHEAD} days. Check back soon or contact ${CONFIG.INSTRUCTOR_NAME} directly.`));
        } else {
          const starts = startsFor(state.date);
          const groups = [
            ['Morning', (t) => t < '12:00'],
            ['Afternoon', (t) => t >= '12:00' && t < '17:00'],
            ['Evening', (t) => t >= '17:00'],
          ];
          groups.forEach(([name, test]) => {
            const list = starts.filter(test);
            if (!list.length) return;
            const group = document.createElement('div');
            group.className = 'times-group';
            group.append(message(name, 'times-group-label'));
            const grid = document.createElement('div');
            grid.className = 'time-grid';
            list.forEach((t) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'time-btn';
              btn.dataset.time = t;
              btn.textContent = formatTime(t);
              btn.setAttribute('aria-pressed', String(t === state.time));
              btn.setAttribute('aria-label', `${formatTime(t)} to ${formatTime(addMinutes(t, state.duration * 60))}`);
              grid.append(btn);
            });
            group.append(grid);
            nodes.push(group);
          });
        }
        el.timesBody.replaceChildren(...nodes);
      };

      const renderSummary = () => {
        const total = state.duration * CONFIG.RATE_PER_HOUR;
        el.sLength.textContent = hoursLabel(state.duration);
        el.sCar.textContent = state.vehicle === 'own' ? 'Your car' : `${CONFIG.INSTRUCTOR_NAME}'s car`;
        el.sDate.textContent = state.date ? formatDate(state.date, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not picked yet';
        el.sTime.textContent = state.time
          ? `${formatTime(state.time)} \u2013 ${formatTime(addMinutes(state.time, state.duration * 60))}`
          : 'Not picked yet';
        el.sTotal.textContent = money(total) + (state.vehicle === 'instructor' ? ' + fuel' : '');
      };

      const render = () => {
        renderCalendar();
        renderTimes();
        renderSummary();
      };

      /* ---------- Status messages ---------- */

      const showStatus = (text) => {
        el.status.textContent = text;
        el.status.hidden = false;
      };
      const clearStatus = () => {
        el.status.hidden = true;
        el.status.textContent = '';
      };

      /* ---------- Interaction: lesson, calendar, times ---------- */

      form.addEventListener('change', (e) => {
        if (e.target.name === 'duration') {
          state.duration = Number(e.target.value);
          state.notice = '';
          reconcileSelection();
          render();
        } else if (e.target.name === 'vehicle') {
          state.vehicle = e.target.value;
          renderSummary();
        }
      });

      el.prev.addEventListener('click', () => {
        state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
        renderCalendar();
      });
      el.next.addEventListener('click', () => {
        state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
        renderCalendar();
      });

      el.calGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.cal-day');
        if (!btn || btn.disabled) return;
        if (state.date !== btn.dataset.date) state.time = null;
        state.date = btn.dataset.date;
        state.notice = '';
        clearStatus();
        render();
        // On phones the times sit below the calendar, so bring them into view
        if (window.matchMedia('(max-width: 719px)').matches) scrollToEl(el.times);
        const firstTime = el.timesBody.querySelector('.time-btn');
        if (firstTime && !window.matchMedia('(max-width: 719px)').matches) firstTime.focus({ preventScroll: true });
      });

      el.timesBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.time-btn');
        if (!btn) return;
        state.time = btn.dataset.time;
        state.notice = '';
        clearStatus();
        renderTimes();
        renderSummary();
        const again = el.timesBody.querySelector(`.time-btn[data-time="${state.time}"]`);
        if (again) again.focus({ preventScroll: true });
      });

      /* ---------- Form validation ---------- */

      const field = (name) => form.elements.namedItem(name);
      const rules = {
        name: (input) => (input.value.trim().length >= 2 ? '' : 'Enter your full name.'),
        phone: (input) => {
          const digits = input.value.replace(/\D/g, '');
          return digits.length >= 10 && digits.length <= 15 ? '' : 'Enter a phone number, including the area code.';
        },
        email: (input) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim()) ? '' : 'Enter an email address, like name@example.com.'),
        experience: (input) => (input.value ? '' : 'Choose the option closest to your driving experience.'),
        permit: (input) => (input.checked ? '' : "You need a valid learner's permit to book a lesson."),
      };

      const validateField = (name) => {
        const input = field(name);
        const error = rules[name](input);
        const errEl = document.getElementById(`e-${name}`);
        input.setAttribute('aria-invalid', error ? 'true' : 'false');
        errEl.textContent = error;
        errEl.hidden = !error;
        return !error;
      };

      // After the first attempt, re-check fields as people fix them
      const recheck = (e) => {
        const name = e.target.name;
        if (state.triedSubmit && rules[name]) validateField(name);
      };
      form.addEventListener('input', recheck);
      form.addEventListener('change', recheck);

      /* ---------- Submit ---------- */

      const setSubmitting = (busy) => {
        state.submitting = busy;
        el.submit.disabled = busy;
        el.submit.setAttribute('aria-busy', String(busy));
        el.submit.textContent = busy ? 'Booking\u2026' : 'Confirm booking';
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.submitting) return;
        state.triedSubmit = true;
        clearStatus();

        if (!state.date || !state.time) {
          showStatus(state.date ? 'Pick a start time for your lesson.' : 'Pick a date and start time for your lesson.');
          scrollToEl(el.schedule);
          return;
        }

        const invalid = Object.keys(rules).filter((name) => !validateField(name));
        if (invalid.length) {
          showStatus('Check the highlighted details and try again.');
          field(invalid[0]).focus();
          return;
        }

        const details = {
          date: state.date,
          time: state.time,
          duration: state.duration,
          vehicle: state.vehicle,
          name: field('name').value.trim(),
          phone: field('phone').value.trim(),
          email: field('email').value.trim(),
          experience: field('experience').value,
          meetingSpot: field('meetingSpot').value.trim(),
          notes: field('notes').value.trim(),
          permit: field('permit').checked,
          website: field('website').value, // spam trap, should be empty
          visitorTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        };

        setSubmitting(true);
        try {
          const result = await Api.book(details);
          showConfirmation(details, result);
        } catch (err) {
          showStatus(err.message);
          if (err.code === 'SLOT_TAKEN') {
            state.time = null;
            await loadAvailability();
            scrollToEl(el.schedule);
          }
        } finally {
          setSubmitting(false);
        }
      });

      /* ---------- Confirmation ---------- */

      const googleCalendarUrl = (d) => {
        const day = d.date.replace(/-/g, '');
        const start = `${d.time.replace(':', '')}00`;
        const end = `${addMinutes(d.time, d.duration * 60).replace(':', '')}00`;
        const params = new URLSearchParams({
          action: 'TEMPLATE',
          text: `Driving lesson with ${CONFIG.INSTRUCTOR_NAME}`,
          dates: `${day}T${start}/${day}T${end}`,
          details: `Bring your learner's permit. ${money(d.duration * CONFIG.RATE_PER_HOUR)} is due on the day of the lesson.`,
          location: d.meetingSpot || '',
        });
        return `https://calendar.google.com/calendar/render?${params.toString()}`;
      };

      const showConfirmation = (d, result) => {
        const total = d.duration * CONFIG.RATE_PER_HOUR;
        const end = addMinutes(d.time, d.duration * 60);
        document.getElementById('confirm-when').textContent =
          `${formatDate(d.date)}, ${formatTime(d.time)} \u2013 ${formatTime(end)}`;
        document.getElementById('confirm-lead').textContent =
          `${CONFIG.INSTRUCTOR_NAME} has been notified and will contact you at ${d.phone} to confirm where to meet.` +
          (Api.isLive() ? ` A confirmation email is on its way to ${d.email}.` : ' (Preview mode: nothing was actually sent.)');
        document.getElementById('confirm-pay').textContent =
          `Pay ${money(total)} on the day of your lesson` + (d.vehicle === 'instructor' ? ', plus the cost of fuel.' : '.');
        document.getElementById('confirm-ref').textContent = result.bookingId || '';
        document.getElementById('gcal-link').href = googleCalendarUrl(d);

        el.form.hidden = true;
        el.confirmation.hidden = false;
        el.confirmation.focus({ preventScroll: true });
        scrollToEl(el.confirmation);
      };

      document.getElementById('book-again').addEventListener('click', () => {
        state.date = null;
        state.time = null;
        state.notice = '';
        state.triedSubmit = false;
        field('permit').checked = false;
        field('notes').value = '';
        clearStatus();
        el.confirmation.hidden = true;
        el.form.hidden = false;
        scrollToEl(document.getElementById('book'));
        loadAvailability(); // keeps name, phone and email filled in for convenience
      });

      /* ---------- Go ---------- */
      loadAvailability({ initial: true });
    },
  };

  /* ------------------------------------------------------------------------
     Start
     ------------------------------------------------------------------------ */
  Nav.init();
  Booking.init();
})();
