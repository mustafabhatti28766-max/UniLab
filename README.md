# UniLab — University Lab & Equipment Booking System

One centralized platform where students and faculty check availability, request labs and equipment, get approvals, use the resources and return them — with conflict detection, smart recommendations, issue/return tracking, notifications and analytics.

```
Search Resource → Check Availability → Submit Request → Approval → Reservation → Usage → Return → Analytics Updated
```

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`; nothing native to compile).

```bash
npm run setup     # install server + client dependencies
npm run dev       # API on :4000 + web app on http://localhost:5173
```

The database is created on first start and filled with ~4 months of realistic demo data. Reset it with `npm run seed`.

**Single server / production:** `npm run build && npm start` → http://localhost:4000

### Demo accounts (password `password123`)

| Role | Email | Notes |
|---|---|---|
| Student / Faculty Member | `student@uni.edu` | Ali Raza (CSE) — has the "Embedded Systems Lab + 5 Arduino kits, Friday 2–4 PM" request pending |
| Student / Faculty Member | `faculty@uni.edu` | Dr. Lina Sultana (EEE) — faculty auto-approval & priority |
| Lab Staff / Lab Incharge | `staff@uni.edu` | Tania Akter (EEE) — approvals, issue/return desk, QR & ID scanning |
| Department Coordinator | `coordinator@uni.edu` | Prof. Farah Ahmed (EEE) — important requests, department rules, priorities |
| Administrator | `admin@uni.edu` | Nadia Karim — users, departments, labs, categories, permissions, system-wide analytics |

## How the project brief maps to the app

| Brief section | Where it lives |
|---|---|
| **2. Student / Faculty** — browse, search by category, dates & time slots, submit with purpose, track, cancel, history | *Labs & equipment*, *New booking* (live day timeline + half-hour equipment availability), *My bookings* (filter by any booking status), booking detail |
| **2. Lab Staff** — availability, equipment, approve/reject, issue, returns, damage/missing, block, maintenance | *Approvals*, *Issue & return*, *Scan QR / ID*, *Maintenance*, lab & equipment pages (status, block, maintenance) |
| **2. Coordinator** — important requests, department labs, booking rules, priority levels, monitor usage, conflicts | Coordinator-level approval queue, *Booking rules* (department overrides + priority weights), *All bookings*, *Analytics*, *Conflicts* |
| **2. Administrator** — users, departments, labs, categories, analytics, **control permissions**, **monitor booking activity** | *Users*, *Departments & categories*, *Roles & permissions* (per-role permission matrix, enforced server-side), *All bookings* (every filter + live activity feed + CSV export), *Analytics*, *Activity log* |
| **3. Workflow & statuses** | Draft → Pending Approval → Approved → Reserved → In Use → Completed, plus Rejected / Cancelled / Overdue / Returned Late / Damaged (status stepper on each booking) |
| **4. Smart features** | Smart Finder (match %), conflict detection, alternative slots/labs/equipment, usage prediction, maintenance recommendation, priority recommendation |
| **5. Lab & equipment management** | Lab statuses Available / Reserved / In Use / Maintenance / Closed; equipment stock "Total / Reserved / In use / Available"; over-booking is impossible |
| **6. Conflicts, issuing & returns** | 1–3 PM vs 2–4 PM conflict → suggests 3–5 PM, another lab, another date; "10 requested, 7 available" → offer 7; issued / due / returned / condition / damage report / late return tracked |
| **7. Data model** | Tables use the brief's exact columns (below) |
| **8. Search, dashboard & analytics** | Filters: lab, equipment, department, category, date, time, availability, booking status; all listed KPIs and charts incl. usage heatmap by weekday, **by lab** and **by department** |
| **9. Notifications, security & rules** | In-app + **web push** (even when closed) + email (SMTP); auth, RBAC permission matrix, input validation, approval history, resource activity history; configurable rules |
| **10. Web/mobile deployment & extras** | Installable mobile app (PWA, offline shell, push), Dockerfile + Render blueprint; QR checkout/return, ID-card scanning, live occupancy, waitlist, damage photos, auto alternative lab, maintenance scheduling, faculty priority, calendar integration, heatmaps |

## Data model (section 7)

Core tables match the brief column-for-column (extra columns support rules, workflow and analytics):

| Table | Brief columns |
|---|---|
| `labs` | `lab_id, lab_name, department_id, capacity, location, facilities, status` |
| `equipment` | `equipment_id, equipment_name, category, total_quantity, available_quantity, condition, maintenance_status, lab_id` |
| `bookings` | `booking_id, user_id, resource_type, resource_id, booking_date, start_time, end_time, purpose, approval_status, booking_status, approved_by` |
| `issues` (Issue / Return) | `issue_id, booking_id, equipment_id, quantity, issued_at, due_at, returned_at, return_condition, remarks` |

`resource_type` is `lab`, `equipment` or `lab_equipment`; `resource_id` points at the lab (or the first equipment item). A booking's equipment lines are in `booking_items`, so one booking can combine a lab with several equipment types (e.g. *Embedded Systems Lab + 5 Arduino kits*). `available_quantity` is kept in sync automatically after every booking, issue, return and maintenance change.

Supporting tables: `departments`, `users`, `categories`, `booking_items`, `booking_events` (approval history), `activity_log`, `damage_reports`, `resource_blocks`, `waitlist`, `notifications`, `push_subscriptions`, `rules`, `role_permissions`, `demand_misses`.

## Architecture

```
Web / Mobile App (React PWA)
        │  REST / JSON (JWT)
        ▼
Backend API (Express) ──► Booking Manager            services/bookings.js
                         ├─ Availability & Conflict Checker  services/availability.js
                         ├─ Rules engine / Permissions     services/rules.js, services/permissions.js
                         ├─ Recommendation engine         services/recommend.js
                         ├─ Analytics & prediction         services/analytics.js
                         ├─ Scheduler (reminders, overdue, no-shows)  services/scheduler.js
                         └─ Approval / Notification Service  services/notify.js, services/push.js
        ▼
Database (SQLite)
        ▼
Student / Faculty / Lab Staff  (in-app, web push, email)
```

## Mobile app & push notifications

- Open the site on a phone (Chrome / Safari) → **Install app** / *Add to Home Screen*. It runs full-screen with its own icon and works offline for the app shell.
- *Profile → Enable push notifications* subscribes the device; approvals, rejections, reminders, return-due, overdue, waitlist and cancellation alerts arrive even when the app is closed.
- Test delivery: `node server/scripts/test-push.mjs student@uni.edu`.

## Calendar integration

- Each booking: **Google Calendar**, **Outlook** and **.ics** buttons.
- *Profile → Calendar integration*: a private, auto-updating subscription feed for Google / Apple / Outlook Calendar (requires the server to be reachable on the internet).

## Deployment

**Docker** (any host):
```bash
docker build -t unilab .
docker run -p 4000:4000 -v unilab-data:/data -e TZ=Asia/Dhaka unilab
```

**Render** (one click): push this repo to GitHub → Render → *New → Blueprint* → select the repo (`render.yaml` creates the service and a persistent disk).

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `TZ` | system | University time zone (booking times are local) |
| `JWT_SECRET` | generated, stored in the data dir | token signing |
| `DATA_DIR` / `DB_PATH` | `server/data` | database, uploads, keys |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | generated, stored in the data dir | web push identity |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | — | email notifications |
| `CORS_ORIGIN` | `http://localhost:5173` | dev web-app origin |

## Security
- bcrypt password hashing, JWT sessions, login rate limiting
- Permission matrix (administrator-controlled) enforced on every endpoint, plus department scoping for staff and coordinators
- Every booking is re-validated on the server; availability is re-checked inside a transaction at submission and approval
- Private, revocable calendar-feed tokens; upload type/size limits; security headers; other users' booking details hidden without the monitoring permission
