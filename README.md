# Drive with Shun — website and booking system

A fast, mobile-first website for Shun's driving lessons, with a live booking calendar.
Students pick a date and time on the site; the booking lands in a Google Sheet that
only Shun can open, and Shun gets an instant alert on her phone.

**Cost to run: $0.** GitHub Pages hosts the site, and Google Apps Script + Google Sheets
run the booking system on a free Google account.

---

## What's in this folder

| File | What it does |
| --- | --- |
| `index.html` | Home page: hero, the "route to confidence", benefits, reviews and the booking calendar |
| `pricing.html` | Pricing & Policies page: hourly rate, car options, same-day payment, requirements checklist, FAQ |
| `admin.html` | **Your private dashboard.** Set your rate and discount, close off dates, change booking statuses and see your money totals |
| `styles.css` | All styling (mobile-first, no frameworks) |
| `script.js` | Mobile menu, calendar, form checks and the connection to Google Sheets |
| `favicon.svg` | The little icon shown in the browser tab |
| `apps-script/Code.gs` | The booking backend. This is **not** used by GitHub; you paste it into Google Apps Script |

### How the pieces fit together

```
Student's phone ──> GitHub Pages site ──> Google Apps Script web app ──> Shun's private Google Sheet
                                                    │                              ▲
                                                    │                              │
        Shun's admin.html (key-protected) ──────────┴──────────────────────────────┘
                                                    │
                                                    └──> Alert to Shun's phone (email / Telegram / Pushover / webhook)
```

The website never sees the Sheet. It can only ask the script two questions:
"which start times are free?" and "please book this one." The script answers with
free times only, so no student's name, phone number or email is ever visible to the public.

---

## Before you start

You need:

- A **Google account** for Shun (a normal Gmail account works).
- A **GitHub account** (free) at <https://github.com>.
- About 30 minutes.

> **Try it first:** open `index.html` in any browser right now. Until you finish Part 1,
> the calendar runs in **preview mode** with sample times, so you can click through the
> whole booking flow. A yellow banner shows that bookings aren't being saved yet.

---

## Part 1 — Set up the booking backend (Google Sheets + Apps Script)

Do these steps while signed in to **Shun's** Google account. Whoever owns the Sheet
owns the bookings and receives the alerts.

### Step 1: Create the private Google Sheet

1. Go to <https://sheets.google.com> and create a **Blank spreadsheet**.
2. Name it something like `Driving Lessons – Bookings`.
3. Check the time zone: **File → Settings → Time zone**. Set it to Shun's local time
   zone and click **Save settings**. Every lesson time is based on this setting.
4. Don't share this Sheet with anyone. It stays private to Shun.

### Step 2: Add the booking script

1. In the Sheet, click **Extensions → Apps Script**. A code editor opens in a new tab.
2. Delete everything in the `Code.gs` file that's already there.
3. Open `apps-script/Code.gs` from this folder, copy **all** of it, and paste it in.
4. Near the top, review the `SETTINGS` block. The defaults already match the website,
   but you may want to change:
   - `BUSINESS_NAME` and `INSTRUCTOR_NAME`
   - `OWNER_EMAIL`: leave blank to send alerts to the account that owns the script
   - `MIN_NOTICE_HOURS` (default 12): how far ahead students must book
   - `MAX_UPCOMING_PER_PERSON` (default 3): stops one person from grabbing every slot
   - **`ADMIN_KEY`**: set this to a private password of your own, e.g. `ADMIN_KEY: 'shun-2026-lessons'`.
     It unlocks the admin dashboard. Leave it blank and the dashboard simply won't open.
     Don't reuse your Google password, and don't share this string with students.
5. Click the **Save** icon (or press Ctrl/Cmd + S).

### Step 3: Run the setup

1. In the toolbar function dropdown (next to **Run** and **Debug**), choose `setup`.
2. Click **Run**.
3. Google asks for permission. Click **Review permissions**, pick Shun's account, and
   allow access.
   - If you see **"Google hasn't verified this app"**, that's normal for your own
     scripts. Click **Advanced → Go to (project name) (unsafe)** → **Allow**. The
     script only touches this Sheet, sends email and sends the alert messages you
     turn on.
4. Go back to the Sheet tab and refresh it. You'll now see three tabs and a new
   **Driving school** menu:

| Tab | What it's for |
| --- | --- |
| **Bookings** | Every lesson booked through the website, one row per booking |
| **Hours** | Shun's regular weekly teaching hours |
| **Time Off** | Days or hours when Shun isn't available |
| **Settings** | The hourly rate and the first-lesson discount percentage |

You can change the rate and discount here, or from `admin.html` — they're the same
two numbers. The website picks up a change within about a minute, with no redeploy.

### Step 4: Set Shun's teaching hours

Open the **Hours** tab. The defaults are Monday–Friday 09:00–17:00 and Saturday
09:00–13:00, closed Sunday. Edit them to match Shun's schedule:

- Use 24-hour times, like `09:00` and `17:30`.
- Leave **Open** and **Close** blank to close that day.
- For a split day, add a second row for the same day
  (for example `Tuesday 09:00 12:00` and `Tuesday 16:00 20:00`).

### Step 5: Publish the script as a web app

1. Back in the Apps Script tab, click **Deploy → New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Fill in:
   - **Description:** `Booking API`
   - **Execute as:** **Me** (Shun's account)
   - **Who has access:** **Anyone**
4. Click **Deploy** and approve permissions again if asked.
5. Copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfy.../exec`.

> **Why "Anyone" is safe here:** "Anyone" lets the website *talk to the script*. It
> does **not** give anyone access to the Sheet. The script runs as Shun, reads the Sheet
> privately, and only ever sends back free start times. The Sheet itself stays
> shared with no one.

### Step 6: Connect the website to the script

1. Open `script.js` in a text editor.
2. Find the `CONFIG` section at the top and paste the URL between the quotes:

   ```js
   API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
   ```

3. Save the file.
4. Open `admin.html` in the same text editor. Near the bottom, inside the `<script>` block,
   find this line and paste the **same** URL into it:

   ```js
   const API_URL = '';
   ```

   Both files need the URL. Save it.

**Test it:** paste the URL into your browser with `?action=availability` on the end.
You should see a short block of text starting with `{"ok":true`. Then open `index.html`:
the yellow preview banner should be gone and the calendar should show Shun's real hours.

### Step 7: Day-to-day use

Most of this is easier from `admin.html` (Part 3), but everything also works
directly in the Sheet:

| To do this | Do this in the Sheet |
| --- | --- |
| See upcoming lessons | Open the **Bookings** tab. Sort or filter by **Lesson date** |
| Cancel a lesson | Change its **Status** to `Cancelled`. The time opens up on the website again right away |
| Track a lesson's progress | Set **Status** to `Started`, `In progress`, `Completed` or `No-show` |
| Change your hourly rate | In **Settings**, edit **Rate per hour** |
| Change the first-lesson discount | In **Settings**, edit **First-lesson discount percent** (`0` turns it off) |
| Block a single day | In **Time Off**, enter the **Date** and leave everything else blank |
| Block a vacation | In **Time Off**, enter the **Date** and a **Through date** |
| Block part of a day | In **Time Off**, enter the **Date** plus **From** and **To** (e.g. `13:00` to `15:00`) |
| Check what students see | **Driving school → Show open times (next 7 days)** |

Don't delete rows from **Bookings**. Changing the Status is safer and keeps a record.

### If you edit Code.gs later

Saving the code isn't enough. You also need to publish a new version, or the website
keeps using the old one:

**Deploy → Manage deployments → pencil icon (Edit) → Version: New version → Deploy.**

The web app URL stays the same, so you don't need to touch `script.js`.

---

## Part 2 — Instant booking alerts on Shun's phone

Pick one or more of these. All of them are free. After changing any setting in
`Code.gs`, save, then publish a new version (see above), then run
**Driving school → Send a test alert** in the Sheet to check it works.

### Option A: Email alert (on by default)

Nothing to set up. Every booking emails Shun with the student's details. Hitting **Reply** writes
straight to the student.

To make it a phone notification, install the **Gmail** app on Shun's phone, sign in
to the same account and allow notifications. Tip: in Gmail, create a filter for
emails with the subject containing `New lesson` and mark them **Important** so they
always notify.

### Option B: Telegram (instant, very reliable)

1. Install **Telegram** on Shun's phone.
2. Open a chat with **@BotFather**, send `/newbot` and follow the prompts. BotFather
   replies with a **bot token** like `123456789:AAH...`.
3. Open a chat with your new bot and send it any message (for example, `hi`).
4. In a browser, visit the following, with your token in place of `<TOKEN>`:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Look for `"chat":{"id":` followed by a number. That's the **chat ID**.
5. In `Code.gs`, fill in:

   ```js
   TELEGRAM_BOT_TOKEN: '123456789:AAH...',
   TELEGRAM_CHAT_ID: '987654321',
   ```

### Option C: Pushover (push notifications with custom sounds)

Pushover is a one-time purchase after a free trial.

1. Sign up at <https://pushover.net> and install the Pushover app on Shun's phone.
2. Copy the **User Key** from the Pushover dashboard.
3. Click **Create an Application/API Token**, name it `Driving lessons`, and copy the
   **API Token**.
4. In `Code.gs`, fill in `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY`.

### Option D: Webhook (Zapier, Make, Slack, Discord, IFTTT…)

Paste any webhook URL into `WEBHOOK_URL`. The script sends a JSON message that works
directly with Slack (`text`) and Discord (`content`) webhooks, and includes every
booking field for tools like Zapier or Make (for example, to send a text message
or add the lesson to Google Calendar automatically).

### Student confirmation emails

With `SEND_CUSTOMER_EMAIL: true` (the default), students also get an email confirming
their lesson, with reminders to bring their learner's permit and pay on the day.

---

## Part 3 — Pricing, the first-lesson discount, and your admin dashboard

### How pricing works

There are two numbers, and they live in the **Settings** tab of your Sheet (and on
`admin.html`, which edits the same tab):

| Number | What it does |
| --- | --- |
| **Rate per hour** | What you charge per hour. A 2-hour lesson is twice this |
| **First-lesson discount percent** | How much a brand-new student saves on their very first lesson. `50` means half price. `0` turns the discount off completely |

You can change either one at any time. The website reads them fresh, so you never
have to touch the code or redeploy to change your prices.

### How the first-lesson discount is decided

When a booking comes in, the script looks through the **Bookings** tab for that
person's phone number or email address.

- **No match** → this is their first lesson, so the discount is applied automatically.
- **A match** → they've booked before, so they pay the full rate.

The student sees the discounted price on their confirmation screen and in their
confirmation email, and your alert says the discount was already applied. The
discounted amount is what gets written into the **Lesson price** column, so your
money totals are always what you'll actually collect.

> Deleting someone's old booking row would make them count as "new" again. Set the
> Status to `Cancelled` instead of deleting, which is what you should do anyway.

### Step 1: Open your admin dashboard

`admin.html` is a private page. It isn't linked from anywhere on the website and it
tells search engines not to index it, so the only way in is the address plus your
admin key.

1. Open `admin.html` (locally, or at `https://YOUR-USERNAME.github.io/drive-with-shun/admin.html`
   once you've done Part 4).
2. Enter the `ADMIN_KEY` you set in `Code.gs`.
3. Bookmark the page on your phone's home screen for one-tap access.

The key is remembered for that browser tab only, so closing the tab signs you out.
There's also a **Sign out** button.

### Step 2: What you can do from it

| Panel | What it's for |
| --- | --- |
| **Rate and first-lesson discount** | Type what you're charging per hour and the discount percentage, then **Save rate**. The website uses the new numbers within about a minute |
| **Close a date or time** | Block a day, a run of days, or just a few hours — without opening the Sheet. Those times disappear from the booking calendar |
| **Money** | Pick a month (or **All time**) and see your lesson count, total hours, **Expected** (every lesson still on the books) and **Collected** (only lessons marked `Completed`) |
| **Bookings** | Every booking, newest first. Change any booking's status from the dropdown in its row, or filter the list by status |

**About the statuses:** `Booked` → `Started` → `In progress` → `Completed` is the
normal path, and `Cancelled` / `No-show` are the exceptions. Marking a lesson
`Cancelled` immediately frees that time up on the website. Only `Completed`
lessons count toward **Collected**, so that figure is the money you've actually
earned, and **Expected** minus **Collected** is roughly what's still owed to you.

> **Keep the admin key private.** Anyone with the key and the page address can see
> every student's name, phone number and email. If you ever think it's been seen,
> change `ADMIN_KEY` in `Code.gs`, redeploy a new version, and update `admin.html`.

---

## Part 4 — Put the website online with GitHub Pages

### Step 1: Personalize the site

Your phone number (816-800-1470) and email (50dollarrental@gmail.com) are already
filled in on both pages. What's left:

- **Service area:** both footers currently say "Lessons in Your City and nearby".
  Search for `Your City` and put in your real town.
- **Reviews:** the three sample reviews in `index.html` are placeholders marked
  "Sample review". Replace them with real quotes from students (with their
  permission), and remove the `<span class="sample-tag">Sample review</span>` lines.
  Until then, you could also delete the reviews section entirely.
- **Payment methods (optional):** in `pricing.html`, list what you accept
  (cash, Zelle, Venmo…). Search for `REPLACE` to find the spot.

**About the prices written on `pricing.html`:** the booking form always uses the
live rate from your Settings tab, but the `$25` figures printed on the pricing page
are plain text. If you change your rate, update those by hand so the two agree.
The discount badge saying "50% off your first lesson" appears on both pages — edit
or delete it there if you change the discount percentage.

### Step 2: Create a repository

1. Sign in at <https://github.com> and click **+ → New repository**.
2. **Repository name:** something short, like `drive-with-shun`.
3. Choose **Public** (free GitHub Pages requires a public repository; the site
   contains no private data, since bookings live in the Google Sheet).
4. Click **Create repository**.

### Step 3: Upload the files

1. On the new repository page, click **uploading an existing file**
   (or **Add file → Upload files**).
2. Drag in `index.html`, `pricing.html`, `admin.html`, `styles.css`, `script.js`,
   `favicon.svg` and `README.md`. These must sit at the **top level** of the
   repository, not inside another folder.
3. Optionally drag in the whole `apps-script` folder too, to keep a backup copy of
   the backend code. It's harmless on the site.
4. Click **Commit changes**.

### Step 4: Turn on GitHub Pages

1. In the repository, go to **Settings → Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
4. Wait a minute or two and refresh the page. A banner appears with the site address:
   `https://YOUR-USERNAME.github.io/drive-with-shun/`

Open it on a phone and make a test booking. It should appear in the **Bookings** tab
and trigger an alert. Then set that test row's Status to `Cancelled`.

### Updating the site later

Open the file on GitHub, click the **pencil** icon, make the change and click
**Commit changes**. The live site updates within a minute or two. If you don't see
the change, do a hard refresh (Ctrl/Cmd + Shift + R) because browsers cache the old files.

### Optional: use your own domain

Buy a domain (for example `drivewithshun.com`), then in **Settings → Pages → Custom
domain** enter it and follow GitHub's instructions for the DNS records. Tick
**Enforce HTTPS** once it's available.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Yellow "Preview mode" banner still shows | `API_URL` in `script.js` is empty or the updated file wasn't uploaded to GitHub |
| "We couldn't load open times" | Check the URL ends in `/exec` (not `/dev`) and that **Who has access** is **Anyone** |
| Changes to `Code.gs` don't take effect | Publish a new version: **Deploy → Manage deployments → Edit → New version** |
| Lesson times are off by a few hours | Fix the Sheet's time zone in **File → Settings**, then publish a new version |
| No alerts arrive | Run **Driving school → Send a test alert**, then check **Executions** in the Apps Script editor for error messages |
| Calendar shows no open days | Check the **Hours** tab uses 24-hour times and that **Time Off** doesn't cover the whole month |
| Two students booked the same time | This can't happen: the script locks the Sheet while it checks and saves each booking, and the second student is asked to pick another time |
| Admin page says "Wrong admin key" | The key must match `ADMIN_KEY` in `Code.gs` exactly, including capitals. If you just changed it, publish a new version first |
| Admin page won't load anything | Check you pasted the `/exec` URL into `admin.html` as well as `script.js` |
| Rate change isn't showing on the site | Give it a minute, then hard refresh (Ctrl/Cmd + Shift + R). Also check the **Settings** tab has a row named exactly `Rate per hour` |
| A returning student got the discount | Their earlier booking row must have been deleted, or they used a different phone and email. Set old bookings to `Cancelled` rather than deleting them |
| Everyone is paying full price | The discount is `0` in the **Settings** tab, or on the admin page |

---

## Built-in protections

- **No double bookings:** every booking is re-checked inside a lock before it's saved.
- **Private data stays private:** the public web app only returns free start times.
- **Learner's permit required:** students must confirm it before they can book, and the
  server checks it too.
- **Spam filter:** a hidden form field quietly discards most bot submissions.
- **Spreadsheet-safe:** text that looks like a formula is stored as plain text.
- **Booking limits:** minimum notice, maximum days ahead, and a cap on upcoming lessons per phone number.
- **Admin access is key-protected:** every admin request is checked against `ADMIN_KEY`, and while that's blank the dashboard refuses to open at all.
- **The discount can't be farmed:** it's decided by the server against your booking history, not by anything the student can type in.
