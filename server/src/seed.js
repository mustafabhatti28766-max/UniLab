import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, insert, resetDatabase, run, tx } from './db.js';
import { computePriority } from './services/bookings.js';
import { getRules } from './services/rules.js';
import { ensureDefaultPermissions } from './services/permissions.js';
import { syncAvailableQuantities } from './services/availability.js';
import { addDays, addMinutes, fromMinutes, nowLocal, pad, today, toMinutes, weekday } from './utils/time.js';

// Deterministic PRNG so the demo data is the same on every machine.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261001);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const randint = (a, b) => a + Math.floor(rand() * (b - a + 1));
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
}

const DEPARTMENTS = [
  ['CSE', 'Computer Science & Engineering', 'Software, AI, networking and systems labs'],
  ['EEE', 'Electrical & Electronic Engineering', 'Embedded systems, electronics and power labs'],
  ['ME', 'Mechanical Engineering', 'CAD/CAM, fabrication and thermal labs'],
  ['MCJ', 'Media, Communication & Journalism', 'Studios, cameras and editing suites'],
  ['PHY', 'Physics', 'Optics, photonics and general physics labs'],
];

// [name, email, role, dept, universityId]
const USERS = [
  ['Nadia Karim', 'admin@uni.edu', 'admin', 'CSE', null],
  ['Prof. Farah Ahmed', 'coordinator@uni.edu', 'coordinator', 'EEE', 'FAC-EEE-001'],
  ['Prof. Imran Hossain', 'imran.hossain@uni.edu', 'coordinator', 'CSE', 'FAC-CSE-001'],
  ['Dr. Omar Siddiqui', 'omar.siddiqui@uni.edu', 'coordinator', 'MCJ', 'FAC-MCJ-001'],
  ['Prof. Rehana Begum', 'rehana.begum@uni.edu', 'coordinator', 'ME', 'FAC-ME-001'],
  ['Tania Akter', 'staff@uni.edu', 'staff', 'EEE', 'STF-EEE-01'],
  ['Rafiq Islam', 'rafiq.islam@uni.edu', 'staff', 'CSE', 'STF-CSE-01'],
  ['Kamal Uddin', 'kamal.uddin@uni.edu', 'staff', 'ME', 'STF-ME-01'],
  ['Sumaiya Noor', 'sumaiya.noor@uni.edu', 'staff', 'MCJ', 'STF-MCJ-01'],
  ['Jamal Chowdhury', 'jamal.chowdhury@uni.edu', 'staff', 'PHY', 'STF-PHY-01'],
  ['Dr. Lina Sultana', 'faculty@uni.edu', 'faculty', 'EEE', 'FAC-EEE-014'],
  ['Dr. Hasan Mahmud', 'hasan.mahmud@uni.edu', 'faculty', 'CSE', 'FAC-CSE-022'],
  ['Dr. Arif Khan', 'arif.khan@uni.edu', 'faculty', 'ME', 'FAC-ME-009'],
  ['Dr. Mehnaz Ali', 'mehnaz.ali@uni.edu', 'faculty', 'MCJ', 'FAC-MCJ-004'],
  ['Dr. Samir Rahman', 'samir.rahman@uni.edu', 'faculty', 'PHY', 'FAC-PHY-002'],
  ['Dr. Nusrat Jahan', 'nusrat.jahan@uni.edu', 'faculty', 'CSE', 'FAC-CSE-031'],
  ['Ali Raza', 'student@uni.edu', 'student', 'CSE', '2022-1-60-101'],
  ['Sara Khan', 'sara.khan@uni.edu', 'student', 'EEE', '2021-2-50-044'],
  ['Zain Ahmed', 'zain.ahmed@uni.edu', 'student', 'CSE', '2022-1-60-117'],
  ['Fatima Noor', 'fatima.noor@uni.edu', 'student', 'ME', '2023-1-70-008'],
  ['Bilal Hussain', 'bilal.hussain@uni.edu', 'student', 'MCJ', '2022-3-90-031'],
  ['Hira Shah', 'hira.shah@uni.edu', 'student', 'EEE', '2023-2-50-019'],
  ['Usman Tariq', 'usman.tariq@uni.edu', 'student', 'CSE', '2021-1-60-088'],
  ['Ayesha Malik', 'ayesha.malik@uni.edu', 'student', 'PHY', '2022-1-80-012'],
  ['Daniyal Iqbal', 'daniyal.iqbal@uni.edu', 'student', 'EEE', '2022-2-50-063'],
  ['Maryam Javed', 'maryam.javed@uni.edu', 'student', 'CSE', '2023-1-60-140'],
  ['Hamza Qureshi', 'hamza.qureshi@uni.edu', 'student', 'ME', '2021-1-70-027'],
  ['Zoya Farooq', 'zoya.farooq@uni.edu', 'student', 'MCJ', '2023-3-90-005'],
  ['Omar Farhan', 'omar.farhan@uni.edu', 'student', 'EEE', '2021-2-50-071'],
  ['Laiba Aslam', 'laiba.aslam@uni.edu', 'student', 'CSE', '2022-1-60-152'],
];

// [code, name, dept, capacity, location, facilities, open, close, approval, restricted, popularity, description]
const LABS = [
  ['CSE-L1', 'Software Engineering Lab', 'CSE', 40, 'Block A, Room 301', ['40 workstations (i7, 16 GB)', 'Dual monitors', 'Projector', 'Smart board', 'Air conditioning'], '08:00', '20:00', 'staff', 0, 0.85, 'General-purpose programming lab for software engineering, web and database courses.'],
  ['CSE-L2', 'AI & Data Science Lab', 'CSE', 24, 'Block A, Room 305', ['24 GPU workstations (RTX 4070)', '10 GbE network', 'Projector', 'VR corner'], '08:00', '21:00', 'staff', 1, 0.7, 'GPU workstations for machine learning, deep learning, computer vision and data science research.'],
  ['CSE-L3', 'Networking Lab', 'CSE', 30, 'Block A, Room 210', ['Cisco routers & switches', 'Network racks', 'Patch panels', 'Projector'], '08:00', '20:00', 'staff', 0, 0.5, 'CCNA-style routing, switching and network security practicals.'],
  ['EEE-L1', 'Embedded Systems Lab', 'EEE', 30, 'Block B, Room 112', ['30 workbenches', 'Soldering stations', 'Oscilloscopes', 'Arduino & Raspberry Pi kits', 'Projector'], '08:00', '20:00', 'staff', 0, 0.9, 'Microcontroller, IoT, sensor and robotics projects with Arduino, ESP32 and Raspberry Pi.'],
  ['EEE-L2', 'Digital Electronics Lab', 'EEE', 20, 'Block B, Room 118', ['Logic trainers', 'Function generators', 'Digital oscilloscopes', 'Projector'], '08:00', '18:00', 'staff', 0, 0.55, 'Digital logic, circuit design, signal measurement and analog electronics experiments.'],
  ['EEE-L3', 'Power Systems Lab', 'EEE', 40, 'Block B, Room 020', ['Machine trainers', 'Transformer benches', 'Power analyzers', 'Safety interlocks'], '09:00', '17:00', 'coordinator', 1, 0.25, 'High-voltage machines and power grid experiments. Supervised sessions only.'],
  ['ME-L1', 'CAD/CAM Lab', 'ME', 30, 'Block C, Room 204', ['30 CAD workstations', 'SolidWorks & AutoCAD', '3D printers', 'Plotter'], '08:00', '20:00', 'staff', 0, 0.5, 'CAD modeling, design and 3D printing for prototyping.'],
  ['ME-L2', 'Fabrication Workshop', 'ME', 15, 'Block C, Ground floor', ['CNC milling machine', 'Lathe', 'Laser cutter', 'Welding bay'], '09:00', '17:00', 'coordinator', 1, 0.2, 'CNC machining, laser cutting, welding and fabrication workshop.'],
  ['MCJ-L1', 'Media Production Studio', 'MCJ', 12, 'Block D, Room 101', ['Green screen', 'Studio lighting rig', 'Soundproof booth', 'Teleprompter'], '08:00', '21:00', 'staff', 0, 0.6, 'Video, photo, film and podcast production studio with green screen and audio recording booth.'],
  ['MCJ-L2', 'Digital Editing Lab', 'MCJ', 25, 'Block D, Room 105', ['25 iMacs', 'Adobe Creative Cloud', 'Color-calibrated displays'], '08:00', '20:00', 'none', 0, 0.45, 'Video editing, photo editing and graphic design suites.'],
  ['PHY-L1', 'Optics & Photonics Lab', 'PHY', 20, 'Block E, Room 015', ['Optical benches', 'He-Ne lasers', 'Spectrometers', 'Dark room'], '08:00', '18:00', 'staff', 0, 0.3, 'Optics, laser, interference and spectroscopy experiments.'],
  ['PHY-L2', 'General Physics Lab', 'PHY', 40, 'Block E, Room 002', ['Mechanics kits', 'Wave apparatus', 'Projector'], '08:00', '18:00', 'none', 0, 0.08, 'Introductory mechanics, waves and thermodynamics practicals.'],
];

const CATEGORIES = [
  ['Microcontroller Kits', 'cpu'],
  ['Single-board Computers', 'circuit-board'],
  ['Measurement Instruments', 'gauge'],
  ['Projectors & Displays', 'projector'],
  ['Computers & Laptops', 'laptop'],
  ['Networking Devices', 'network'],
  ['Cameras & Imaging', 'camera'],
  ['Audio Equipment', 'mic'],
  ['Lighting', 'lamp'],
  ['3D Printing & Fabrication', 'printer'],
  ['Research Tools', 'flask'],
  ['VR & Immersive', 'glasses'],
];

// [code, name, category, lab, total, condition, maintenance_status, approval, max_per_booking, description]
const EQUIPMENT = [
  ['EQ-ARD-UNO', 'Arduino Uno Starter Kit', 'Microcontroller Kits', 'EEE-L1', 20, 'good', 'operational', 'staff', 12, 'Arduino Uno R3 with breadboard, sensors, LEDs, servo and jumper wires.'],
  ['EQ-ESP32', 'ESP32 IoT Dev Kit', 'Microcontroller Kits', 'EEE-L1', 15, 'good', 'operational', 'staff', 10, 'Wi-Fi/Bluetooth ESP32 boards with sensor shield.'],
  ['EQ-STM32', 'STM32 Nucleo Board', 'Microcontroller Kits', 'EEE-L2', 10, 'good', 'operational', 'staff', 8, 'ARM Cortex-M4 development boards.'],
  ['EQ-RPI4', 'Raspberry Pi 4 Kit (4 GB)', 'Single-board Computers', 'EEE-L1', 12, 'good', 'operational', 'staff', 6, 'Raspberry Pi 4 with case, power supply, 32 GB SD card and camera module.'],
  ['EQ-OSC', 'Digital Oscilloscope (Rigol DS1054Z)', 'Measurement Instruments', 'EEE-L2', 8, 'fair', 'needs_inspection', 'staff', 4, '4-channel 50 MHz digital oscilloscope.'],
  ['EQ-FGEN', 'Function Generator', 'Measurement Instruments', 'EEE-L2', 10, 'good', 'operational', 'staff', 5, '25 MHz arbitrary waveform generator.'],
  ['EQ-DMM', 'Digital Multimeter', 'Measurement Instruments', 'EEE-L1', 30, 'good', 'operational', 'none', 15, 'Auto-ranging handheld multimeter.'],
  ['EQ-SOLDER', 'Soldering Station', 'Measurement Instruments', 'EEE-L1', 15, 'good', 'operational', 'none', 8, 'Temperature-controlled soldering station with fume extractor.'],
  ['EQ-PROJ', 'Portable Projector (Epson)', 'Projectors & Displays', 'CSE-L1', 6, 'good', 'operational', 'staff', 1, '3LCD 3600-lumen portable projector with HDMI.'],
  ['EQ-PROJ4K', '4K Laser Projector', 'Projectors & Displays', 'MCJ-L1', 2, 'new', 'operational', 'coordinator', 1, 'Short-throw 4K laser projector for screenings and events.'],
  ['EQ-LAPTOP', 'Dell Latitude Laptop', 'Computers & Laptops', 'CSE-L1', 25, 'good', 'operational', 'staff', 10, 'Core i5 laptops with development tools pre-installed.'],
  ['EQ-MACBOOK', 'MacBook Pro 14"', 'Computers & Laptops', 'MCJ-L2', 8, 'good', 'operational', 'staff', 2, 'M3 MacBook Pro with Final Cut Pro and Adobe CC.'],
  ['EQ-CISCO-RTR', 'Cisco 2901 Router', 'Networking Devices', 'CSE-L3', 12, 'good', 'operational', 'staff', 8, 'Integrated services router for CCNA practicals.'],
  ['EQ-CISCO-SW', 'Cisco Catalyst 2960 Switch', 'Networking Devices', 'CSE-L3', 12, 'good', 'operational', 'staff', 8, '24-port managed switch.'],
  ['EQ-CABLE-KIT', 'Network Cable Crimping Kit', 'Networking Devices', 'CSE-L3', 20, 'good', 'operational', 'none', 10, 'Crimper, tester, RJ45 connectors and Cat6 cable.'],
  ['EQ-DSLR', 'Canon EOS R6 Camera', 'Cameras & Imaging', 'MCJ-L1', 5, 'good', 'operational', 'staff', 2, 'Full-frame mirrorless camera with 24-105 mm lens.'],
  ['EQ-GOPRO', 'GoPro Hero 12', 'Cameras & Imaging', 'MCJ-L1', 6, 'good', 'operational', 'staff', 2, 'Action camera with mounts and spare batteries.'],
  ['EQ-DRONE', 'DJI Mavic 3 Drone', 'Cameras & Imaging', 'MCJ-L1', 2, 'good', 'operational', 'coordinator', 1, 'Camera drone. Licensed operators only; coordinator approval required.'],
  ['EQ-MIC', 'Rode Wireless GO II Mic Kit', 'Audio Equipment', 'MCJ-L1', 8, 'good', 'operational', 'staff', 4, 'Dual-channel wireless microphone system.'],
  ['EQ-LIGHT', 'LED Studio Light Kit', 'Lighting', 'MCJ-L1', 6, 'good', 'operational', 'staff', 3, 'Bi-color LED panels with stands and softboxes.'],
  ['EQ-3DP', 'Prusa MK4 3D Printer', '3D Printing & Fabrication', 'ME-L1', 4, 'fair', 'operational', 'staff', 2, 'FDM 3D printer, PLA/PETG.'],
  ['EQ-THERMAL', 'FLIR Thermal Camera', 'Research Tools', 'ME-L1', 3, 'good', 'operational', 'coordinator', 1, 'Thermal imaging camera for heat-transfer research.'],
  ['EQ-SPECTRO', 'USB Spectrometer', 'Research Tools', 'PHY-L1', 4, 'good', 'operational', 'coordinator', 2, 'UV-VIS-NIR spectrometer.'],
  ['EQ-LASER', 'He-Ne Laser Kit', 'Research Tools', 'PHY-L1', 6, 'good', 'operational', 'staff', 3, '632.8 nm laser with optics mounts.'],
  ['EQ-VR', 'Meta Quest 3 Headset', 'VR & Immersive', 'CSE-L2', 10, 'new', 'operational', 'staff', 6, 'Standalone VR/MR headsets for immersive app development.'],
];

const LAB_EQUIPMENT_USE = {
  'EEE-L1': [['EQ-ARD-UNO', 4, 10], ['EQ-ESP32', 3, 8], ['EQ-RPI4', 2, 5], ['EQ-DMM', 5, 12], ['EQ-SOLDER', 3, 8]],
  'EEE-L2': [['EQ-OSC', 2, 4], ['EQ-FGEN', 2, 5], ['EQ-STM32', 2, 6]],
  'CSE-L3': [['EQ-CISCO-RTR', 3, 8], ['EQ-CISCO-SW', 3, 8], ['EQ-CABLE-KIT', 4, 10]],
  'MCJ-L1': [['EQ-DSLR', 1, 2], ['EQ-MIC', 1, 3], ['EQ-LIGHT', 1, 3]],
  'ME-L1': [['EQ-3DP', 1, 2]],
  'PHY-L1': [['EQ-LASER', 1, 3], ['EQ-SPECTRO', 1, 1]],
  'CSE-L2': [['EQ-VR', 2, 6]],
};
const EQUIPMENT_ONLY = [
  ['EQ-PROJ', 1, 1, 3], ['EQ-LAPTOP', 1, 5, 3], ['EQ-DSLR', 1, 1, 3], ['EQ-GOPRO', 1, 2, 2], ['EQ-ARD-UNO', 1, 5, 3],
  ['EQ-RPI4', 1, 3, 2], ['EQ-MIC', 1, 2, 2], ['EQ-THERMAL', 1, 1, 1], ['EQ-MACBOOK', 1, 2, 2], ['EQ-DRONE', 1, 1, 1], ['EQ-ESP32', 1, 4, 2],
];

const PURPOSES = {
  CSE: [['class', 'CSE 3104 Software Engineering lab session'], ['class', 'Database Systems practical'], ['project', 'Web app group project sprint'], ['thesis', 'Thesis experiments — model training'], ['research', 'Computer vision research benchmark'], ['workshop', 'Git & DevOps workshop'], ['club', 'Programming club contest practice'], ['class', 'CCNA routing & subnetting practical'], ['project', 'Network security project — firewall configuration']],
  EEE: [['class', 'EEE 2201 Embedded Systems lab'], ['project', 'IoT smart irrigation prototype'], ['project', 'Line-following robot build session'], ['class', 'Digital Logic Design practical'], ['thesis', 'Final-year project — sensor network testing'], ['research', 'Signal analysis research measurements'], ['exam', 'Embedded systems lab exam'], ['workshop', 'Arduino workshop for first-years']],
  ME: [['class', 'CAD modeling lab — SolidWorks'], ['project', '3D printing prototype for design project'], ['thesis', 'Thermal analysis thesis experiments'], ['class', 'Machine drawing practical'], ['workshop', 'CNC safety workshop']],
  MCJ: [['project', 'Documentary film shoot'], ['class', 'Photography fundamentals practical'], ['project', 'Podcast recording session'], ['club', 'Film society short film'], ['class', 'Video editing lab'], ['exam', 'TV production practical exam']],
  PHY: [['class', 'Optics lab — interference experiments'], ['research', 'Laser spectroscopy research'], ['class', 'Mechanics practical'], ['thesis', 'Photonics thesis measurements']],
};

const REJECTIONS = [
  ['conflict', 'Overlaps with a scheduled class in this lab.', 30],
  ['insufficient_justification', 'Purpose not described in enough detail — please resubmit with project details.', 18],
  ['rules', 'Exceeds the maximum booking duration for students.', 14],
  ['maintenance', 'Lab is scheduled for maintenance at this time.', 10],
  ['priority', 'Slot allocated to a higher-priority exam session.', 16],
  ['unavailable', 'Requested equipment is reserved for a department event.', 12],
];

export function seed() {
  const hash = bcrypt.hashSync('password123', 10);
  const nowStr = nowLocal();
  const todayStr = today();
  const nowMin = toMinutes(nowStr.slice(11, 16));

  tx(() => {
    // --- Catalog -------------------------------------------------------------
    const dept = {};
    for (const [code, name, description] of DEPARTMENTS) dept[code] = insert('INSERT INTO departments (code, name, description) VALUES (?, ?, ?)', code, name, description);

    const users = [];
    for (const [name, email, role, d, sid] of USERS) {
      const id = insert(
        `INSERT INTO users (name, email, password_hash, role, department_id, student_id, phone, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        name, email, hash, role, dept[d], sid, `+880 17${randint(10000000, 99999999)}`, `${addDays(todayStr, -randint(140, 400))}T09:00:00`,
        `${addDays(todayStr, -randint(0, 6))}T${pad(randint(8, 18))}:${pad(randint(0, 59))}`,
      );
      users.push({ id, name, email, role, dept: d, department_id: dept[d], late_return_count: 0 });
    }
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
    const staffOf = (d) => users.find((u) => u.role === 'staff' && u.dept === d) || users[0];
    const coordOf = (d) => users.find((u) => u.role === 'coordinator' && u.dept === d) || users[0];

    const labs = {};
    for (const [code, name, d, cap, loc, fac, open, close, approval, restricted, popularity, description] of LABS) {
      const id = insert(
        `INSERT INTO labs (code, lab_name, department_id, capacity, location, facilities, description, open_time, close_time, approval_level, restricted_to_department, incharge_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code, name, dept[d], cap, loc, JSON.stringify(fac), description, open, close, approval, restricted, staffOf(d).id,
      );
      labs[code] = { id, code, name, dept: d, department_id: dept[d], capacity: cap, open: toMinutes(open), close: toMinutes(close), approval, popularity };
    }

    const cats = {};
    for (const [name, icon] of CATEGORIES) cats[name] = insert('INSERT INTO categories (name, icon) VALUES (?, ?)', name, icon);

    const eqs = {};
    for (const [code, name, cat, lab, total, condition, mstatus, approval, maxPer, description] of EQUIPMENT) {
      const lastService = `${addDays(todayStr, -randint(20, 160))}T10:00`;
      const id = insert(
        `INSERT INTO equipment (code, equipment_name, category, category_id, lab_id, description, total_quantity, available_quantity, condition, maintenance_status, approval_level, max_per_booking, last_maintenance_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        code, name, cat, cats[cat], labs[lab].id, description, total, total, condition, mstatus, approval, maxPer, lastService,
      );
      eqs[code] = { id, code, name, total, lab, approval, dept: labs[lab].dept };
    }

    // --- Booking generator with integrity tracking ---------------------------
    const labBusy = new Map(); // `${labId}|${date}` → [[s,e],...] minutes
    const eqUse = new Map(); // `${eqId}|${date}|${halfHour}` → qty
    const refs = new Set();
    const slotKeys = (date, s, e) => {
      const out = [];
      for (let t = Math.floor(s / 30) * 30; t < e; t += 30) out.push(`${date}|${t}`);
      return out;
    };
    const labFree = (labId, date, s, e) => !(labBusy.get(`${labId}|${date}`) || []).some(([a, b]) => s < b && a < e);
    const eqFree = (eq, date, s, e, q) => slotKeys(date, s, e).every((k) => (eqUse.get(`${eq.id}|${k}`) || 0) + q <= eq.total);
    const hold = (labId, items, date, s, e) => {
      if (labId) {
        const k = `${labId}|${date}`;
        labBusy.set(k, [...(labBusy.get(k) || []), [s, e]]);
      }
      for (const { eq, q } of items) for (const k of slotKeys(date, s, e)) eqUse.set(`${eq.id}|${k}`, (eqUse.get(`${eq.id}|${k}`) || 0) + q);
    };
    const newRef = (date) => {
      for (;;) {
        const ref = `BK-${date.replace(/-/g, '').slice(2)}-${Math.floor(rand() * 65536).toString(16).toUpperCase().padStart(4, '0')}`;
        if (!refs.has(ref)) {
          refs.add(ref);
          return ref;
        }
      }
    };
    const stamp = (s) => (s.length === 16 ? `${s}:00` : s);
    const past = (s) => (s.slice(0, 16) > nowStr ? nowStr : s);
    const HOLDING = new Set(['approved', 'reserved', 'in_use', 'overdue', 'completed', 'returned_late', 'damaged']);
    let fixedPhase = true; // scenario bookings (incl. pending ones) are protected from random collisions

    function addBooking(o) {
      const { user, lab = null, items = [], date, s, e, status, purpose_type, purpose, attendees = 1 } = o;
      const startAt = `${date}T${fromMinutes(s)}`;
      const endAt = `${date}T${fromMinutes(e)}`;
      const deptCode = lab ? lab.dept : items[0]?.eq.dept;
      const deptId = dept[deptCode];
      const createdAt = o.createdAt || `${addDays(date, -randint(1, 5))}T${pad(randint(8, 21))}:${pad(randint(0, 59))}`;
      const createdAtFixed = createdAt > nowStr ? addMinutes(nowStr, -randint(30, 600)) : createdAt;
      const levels = [lab?.approval, ...items.map((i) => i.eq.approval)];
      const required = levels.includes('coordinator') ? 'coordinator' : 'staff';
      const approver = required === 'coordinator' ? coordOf(deptCode) : staffOf(deptCode);
      const isFaculty = user.role !== 'student';
      const autoApproved = isFaculty && required === 'staff';
      const approvedAt = past(addMinutes(createdAtFixed.slice(0, 16), randint(20, 600)));
      const rules = getRules(deptId);
      const pr = computePriority(user, { purpose_type, attendees }, rules, startAt);
      let approvalStatus = 'pending';
      if (['approved', 'reserved', 'in_use', 'overdue', 'completed', 'returned_late', 'damaged'].includes(status)) approvalStatus = autoApproved ? 'auto' : 'approved';
      if (status === 'rejected') approvalStatus = 'rejected';
      if (status === 'cancelled') approvalStatus = o.cancelledWhilePending ? 'pending' : autoApproved ? 'auto' : 'approved';
      if (status === 'draft') approvalStatus = 'none';
      const rejection = status === 'rejected' ? o.rejection || weighted(REJECTIONS.map((r) => [r, r[2]])) : null;
      const late = status === 'returned_late' ? o.lateMin || randint(30, 240) : 0;
      const completedAt = ['completed', 'returned_late', 'damaged'].includes(status) ? past(addMinutes(endAt, late || randint(-10, 10))) : null;

      const id = insert(
        `INSERT INTO bookings (ref_code, user_id, department_id, lab_id, resource_type, resource_id, booking_date, start_time, end_time, start_at, end_at,
           purpose, purpose_type, attendees, priority, priority_score, required_approval, approval_status, booking_status, approved_by, approved_at,
           rejection_reason, rejection_category, cancel_reason, checked_in_at, completed_at, qr_token, reminder_sent, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newRef(createdAtFixed.slice(0, 10)), user.id, deptId, lab?.id ?? null,
        lab && items.length ? 'lab_equipment' : lab ? 'lab' : 'equipment',
        lab ? lab.id : items[0].eq.id,
        date, fromMinutes(s), fromMinutes(e), startAt, endAt, purpose, purpose_type, attendees, pr.level, pr.score,
        autoApproved && status !== 'pending' ? 'none' : required, approvalStatus, status,
        ['approved', 'rejected'].includes(approvalStatus) ? approver.id : null,
        approvalStatus === 'approved' || approvalStatus === 'auto' ? approvedAt : null,
        rejection ? rejection[1] : null, rejection ? rejection[0] : null,
        status === 'cancelled' ? o.cancelReason || pick(['Project meeting moved', 'Group member unavailable', 'Rescheduled class', 'No longer needed']) : null,
        ['in_use', 'overdue', 'completed', 'returned_late', 'damaged'].includes(status) ? addMinutes(startAt, randint(-10, 5)) : null,
        completedAt, crypto.randomBytes(12).toString('hex'), startAt <= addMinutes(nowStr, 60) ? 1 : 0, stamp(createdAtFixed), stamp(completedAt || approvedAt),
      );
      for (const { eq, q } of items) insert('INSERT INTO booking_items (booking_id, equipment_id, quantity) VALUES (?, ?, ?)', id, eq.id, q);
      if (HOLDING.has(status) || (status === 'pending' && fixedPhase)) hold(lab?.id, items, date, s, e);

      // Approval history
      const ev = (action, from, to, actor, at, note = null) =>
        insert('INSERT INTO booking_events (booking_id, actor_id, action, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?,?)', id, actor, action, from, to, note, stamp(past(at)));
      ev('submitted', null, 'pending', user.id, createdAtFixed, purpose);
      if (approvalStatus === 'auto') ev('auto_approved', 'pending', 'approved', null, createdAtFixed, 'Faculty auto-approval applies');
      if (approvalStatus === 'approved') ev('approved', 'pending', 'approved', approver.id, approvedAt);
      if (status === 'rejected') ev('rejected', 'pending', 'rejected', approver.id, approvedAt, rejection[1]);
      if (['reserved', 'in_use', 'overdue', 'completed', 'returned_late', 'damaged'].includes(status)) {
        const reservedAt = addMinutes(startAt, -randint(60, 1440));
        ev('reserved', 'approved', 'reserved', null, reservedAt < approvedAt ? approvedAt : reservedAt, 'Time slot and equipment locked for this booking');
      }
      if (status === 'cancelled') ev(o.noShow ? 'no_show' : 'cancelled', 'approved', 'cancelled', o.noShow ? null : user.id, o.noShow ? endAt : addMinutes(startAt, -randint(60, 2000)));
      if (['in_use', 'overdue', 'completed', 'returned_late', 'damaged'].includes(status)) ev('checked_in', 'reserved', 'in_use', staffOf(deptCode).id, startAt, items.length ? `${items.reduce((a, i) => a + i.q, 0)} item(s) issued` : 'Lab access granted');
      if (status === 'overdue') ev('overdue', 'in_use', 'overdue', null, addMinutes(endAt, 15), 'Equipment not returned by the due time');
      if (['completed', 'returned_late', 'damaged'].includes(status)) {
        ev(items.length ? 'returned' : 'completed', 'in_use', status, staffOf(deptCode).id, completedAt, status === 'damaged' ? 'Damage/missing items recorded' : status === 'returned_late' ? 'Returned after due time' : items.length ? 'All items returned in good condition' : 'Lab checked out');
      }

      // Issue / return records
      if (['in_use', 'overdue', 'completed', 'returned_late', 'damaged'].includes(status)) {
        items.forEach(({ eq, q }, idx) => {
          const returned = ['completed', 'returned_late', 'damaged'].includes(status);
          const damaged = status === 'damaged' && idx === 0 ? Math.min(q, o.damagedQty || 1) : 0;
          const issueId = insert(
            `INSERT INTO issues (booking_id, equipment_id, quantity, issued_by, issued_at, due_at, returned_at, received_by, returned_good, returned_damaged,
               returned_missing, return_condition, remarks, is_late) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            id, eq.id, q, staffOf(deptCode).id, startAt, endAt, returned ? completedAt : null, returned ? staffOf(deptCode).id : null,
            returned ? q - damaged : null, returned ? damaged : null, returned ? 0 : null,
            returned ? (damaged ? 'damaged' : 'good') : null, damaged ? o.damageNote || 'Damaged on return' : null, status === 'returned_late' ? 1 : 0,
          );
          if (damaged) {
            insert(
              `INSERT INTO damage_reports (equipment_id, booking_id, issue_id, reported_by, responsible_user_id, kind, quantity, severity, description, status, resolved_at, created_at)
               VALUES (?,?,?,?,?,'damaged',?,?,?,?,?,?)`,
              eq.id, id, issueId, staffOf(deptCode).id, user.id, damaged, pick(['low', 'medium', 'high']), o.damageNote || 'Damaged on return',
              o.damageStatus || 'resolved', (o.damageStatus || 'resolved') === 'resolved' ? stamp(addMinutes(completedAt, 3 * 1440)) : null, stamp(completedAt),
            );
          }
        });
      }
      return id;
    }

    // --- Fixed scenario bookings (created first so random data never collides) ---
    const clamp = (m) => Math.max(0, Math.min(23 * 60 + 59, m));
    const round30 = (m) => Math.round(m / 30) * 30;
    const student = byEmail['student@uni.edu'];
    const faculty = byEmail['faculty@uni.edu'];
    const sara = byEmail['sara.khan@uni.edu'];
    const E = (code, q) => ({ eq: eqs[code], q });
    const nextFriday = (() => {
      let d = addDays(todayStr, 1);
      while (weekday(d) !== 5) d = addDays(d, 1);
      return d;
    })();

    // 1. Live session right now: Embedded Systems Lab with 5 Arduino kits issued → "In use 5".
    const liveS = clamp(round30(nowMin - 60));
    const liveE = clamp(Math.max(liveS + 60, round30(nowMin + 60)));
    addBooking({ user: faculty, lab: labs['EEE-L1'], items: [E('EQ-ARD-UNO', 5)], date: todayStr, s: liveS, e: liveE, status: 'in_use', purpose_type: 'class', purpose: 'EEE 2201 Embedded Systems lab — PWM & motor control', attendees: 26 });
    addBooking({ user: byEmail['hasan.mahmud@uni.edu'], lab: labs['CSE-L1'], date: todayStr, s: liveS, e: liveE, status: 'in_use', purpose_type: 'class', purpose: 'CSE 3104 Software Engineering lab session', attendees: 34 });
    addBooking({ user: byEmail['bilal.hussain@uni.edu'], lab: labs['MCJ-L1'], items: [E('EQ-DSLR', 1), E('EQ-LIGHT', 2)], date: todayStr, s: liveS, e: liveE, status: 'in_use', purpose_type: 'project', purpose: 'Documentary interview shoot', attendees: 4 });

    // 2. Later today: 8 Arduino kits reserved → "Reserved 8, Available 7".
    if (nowMin + 90 < 22 * 60) {
      const s = clamp(round30(nowMin + 90));
      addBooking({ user: byEmail['daniyal.iqbal@uni.edu'], items: [E('EQ-ARD-UNO', 8)], date: todayStr, s, e: clamp(s + 120), status: 'reserved', purpose_type: 'project', purpose: 'Robotics club build night', attendees: 8 });
    }
    // 3. Starting in ~30 minutes — ready for check-in at the issue desk (demo student, EEE lab).
    if (nowMin + 30 < 22 * 60) {
      const s = clamp(Math.ceil((nowMin + 20) / 30) * 30);
      addBooking({ user: student, lab: labs['EEE-L2'], items: [E('EQ-OSC', 2)], date: todayStr, s, e: clamp(s + 120), status: 'reserved', purpose_type: 'project', purpose: 'Signal measurement for digital filter project', attendees: 3 });
    }
    // 4. Overdue: ESP32 kits from yesterday were never returned.
    const yesterday = addDays(todayStr, -1);
    addBooking({ user: sara, items: [E('EQ-ESP32', 2)], date: yesterday, s: 14 * 60, e: 16 * 60, status: 'overdue', purpose_type: 'thesis', purpose: 'Final-year project — sensor network testing' });

    // 5. Friday — the "Embedded Systems Lab + 5 Arduino kits, 2–4 PM" scenario.
    addBooking({ user: faculty, lab: labs['EEE-L1'], items: [E('EQ-SOLDER', 10)], date: nextFriday, s: 10 * 60, e: 12 * 60, status: 'approved', purpose_type: 'class', purpose: 'EEE 2201 Embedded Systems lab — soldering practice', attendees: 28 });
    addBooking({ user: byEmail['lina.sultana@uni.edu'] || faculty, lab: labs['EEE-L2'], items: [E('EQ-ARD-UNO', 5)], date: nextFriday, s: 13 * 60, e: 15 * 60, status: 'approved', purpose_type: 'class', purpose: 'Digital Logic Design practical with microcontrollers', attendees: 18 });
    addBooking({ user: byEmail['omar.farhan@uni.edu'], items: [E('EQ-ARD-UNO', 8)], date: nextFriday, s: 14 * 60, e: 17 * 60, status: 'approved', purpose_type: 'workshop', purpose: 'Arduino workshop for first-years', attendees: 16 });
    addBooking({ user: student, lab: labs['EEE-L1'], items: [E('EQ-ARD-UNO', 5)], date: nextFriday, s: 14 * 60, e: 16 * 60, status: 'pending', purpose_type: 'project', purpose: 'Project session — IoT smart irrigation prototype with soil-moisture sensors', attendees: 5, createdAt: addMinutes(nowStr, -180) });
    addBooking({ user: byEmail['hira.shah@uni.edu'], lab: labs['EEE-L1'], items: [E('EQ-RPI4', 4)], date: nextFriday, s: 15 * 60, e: 17 * 60, status: 'pending', purpose_type: 'club', purpose: 'Robotics society meetup', attendees: 12, createdAt: addMinutes(nowStr, -95) });

    // 6. Other pending requests across departments.
    // Upcoming open days (labs are closed on Sundays): openDays[0] is 2 days from now.
    const openDays = [];
    for (let n = 2; openDays.length < 8; n++) if (weekday(addDays(todayStr, n)) !== 0) openDays.push(addDays(todayStr, n));
    const openDay = (n) => openDays[Math.min(openDays.length - 1, n - 2)];
    const [d2, d3, d4] = openDays;
    const d6 = openDay(6);
    addBooking({ user: faculty, lab: labs['EEE-L3'], date: d3, s: 9 * 60, e: 12 * 60, status: 'pending', purpose_type: 'class', purpose: 'Power systems lab — transformer efficiency tests', attendees: 35, createdAt: addMinutes(nowStr, -300) });
    addBooking({ user: byEmail['daniyal.iqbal@uni.edu'], items: [E('EQ-OSC', 2), E('EQ-FGEN', 2)], date: d2, s: 10 * 60, e: 12 * 60, status: 'pending', purpose_type: 'research', purpose: 'Signal analysis research measurements', attendees: 2, createdAt: addMinutes(nowStr, -60) });
    addBooking({ user: byEmail['zoya.farooq@uni.edu'], items: [E('EQ-DRONE', 1)], date: d4, s: 9 * 60, e: 12 * 60, status: 'pending', purpose_type: 'project', purpose: 'Aerial shots for campus documentary', attendees: 3, createdAt: addMinutes(nowStr, -240) });
    addBooking({ user: byEmail['zain.ahmed@uni.edu'], lab: labs['CSE-L2'], date: d2, s: 14 * 60, e: 17 * 60, status: 'pending', purpose_type: 'thesis', purpose: 'Thesis experiments — deep learning model training on GPU', attendees: 3, createdAt: addMinutes(nowStr, -420) });
    addBooking({ user: byEmail['hamza.qureshi@uni.edu'], items: [E('EQ-3DP', 2)], date: d3, s: 13 * 60, e: 16 * 60, status: 'pending', purpose_type: 'project', purpose: '3D printing prototype for design project', attendees: 2, createdAt: addMinutes(nowStr, -30) });
    addBooking({ user: byEmail['ayesha.malik@uni.edu'], lab: labs['PHY-L1'], items: [E('EQ-LASER', 2)], date: d6, s: 10 * 60, e: 12 * 60, status: 'pending', purpose_type: 'research', purpose: 'Laser spectroscopy research', attendees: 2, createdAt: addMinutes(nowStr, -720) });
    addBooking({ user: student, lab: labs['CSE-L3'], items: [E('EQ-CISCO-RTR', 4), E('EQ-CISCO-SW', 4)], date: d4, s: 14 * 60, e: 16 * 60, status: 'approved', purpose_type: 'project', purpose: 'Network security project — VLAN & ACL configuration', attendees: 4, createdAt: addMinutes(nowStr, -2000) });
    addBooking({ user: student, lab: labs['CSE-L1'], date: d6, s: 16 * 60, e: 18 * 60, status: 'draft', purpose_type: 'project', purpose: 'Group sprint review (draft)', attendees: 6, createdAt: addMinutes(nowStr, -100) });

    // Keep upcoming maintenance windows free of random bookings.
    const d5 = openDay(5);
    const d8 = openDay(8);
    hold(labs['CSE-L3'].id, [], d2, 8 * 60, 13 * 60);
    hold(null, [E('EQ-GOPRO', 3)], d8, 8 * 60, 20 * 60);
    hold(null, [E('EQ-3DP', 1)], d5, 9 * 60, 13 * 60);
    fixedPhase = false;

    // --- Random history (−120 days) and upcoming schedule (+14 days) ---------
    const students = users.filter((u) => u.role === 'student');
    const facultyList = users.filter((u) => u.role === 'faculty');
    const hourWeights = [[8, 1], [9, 2], [10, 3], [11, 3], [12, 1.4], [13, 2], [14, 3], [15, 2.5], [16, 2], [17, 1], [18, 0.5]];
    // The demo student only gets the hand-crafted upcoming bookings, so they stay under the active-booking limit.
    const otherStudents = students.filter((u) => u.email !== 'student@uni.edu');
    let historyPhase = true;
    const pickUser = (d, isClass) => {
      const pool = isClass ? facultyList : historyPhase ? students : otherStudents;
      const local = pool.filter((u) => u.dept === d);
      return local.length && chance(0.75) ? pick(local) : pick(pool);
    };

    for (let offset = -120; offset <= 14; offset++) {
      const date = addDays(todayStr, offset);
      const wd = weekday(date);
      historyPhase = offset < 0;
      if (wd === 0) continue;
      const growth = 0.72 + 0.4 * ((offset + 120) / 134);
      const wdFactor = [0, 1, 1.05, 1, 1, 0.8, 0.4][wd];
      const futureFactor = offset > 0 ? Math.max(0.25, 1 - offset / 16) : 1; // fewer bookings made far ahead

      for (const lab of Object.values(labs)) {
        const sessions = Math.floor(lab.popularity * growth * wdFactor * futureFactor * 3.4 + rand());
        for (let n = 0; n < sessions; n++) {
          for (let attempt = 0; attempt < 4; attempt++) {
            const startH = weighted(hourWeights);
            const s = startH * 60;
            const e = s + 60 * weighted([[1, 2], [2, 4], [3, 2]]);
            if (s < lab.open || e > lab.close || !labFree(lab.id, date, s, e)) continue;
            if (offset === 0 && !(e <= nowMin - 30 || s >= nowMin + 60)) continue;
            const [ptype, purpose] = pick(PURPOSES[lab.dept]);
            const isClass = ['class', 'exam'].includes(ptype) || (ptype === 'workshop' && chance(0.5));
            const user = pickUser(lab.dept, isClass);
            const attendees = isClass ? randint(Math.round(lab.capacity * 0.5), lab.capacity) : randint(1, Math.min(8, lab.capacity));
            const items = [];
            for (const [code, lo, hi] of LAB_EQUIPMENT_USE[lab.code] || []) {
              if (offset === 0 && code === 'EQ-ARD-UNO') continue; // keep today's Arduino scenario exact
              if (items.length < 2 && chance(0.32)) {
                const q = Math.min(eqs[code].total, randint(lo, hi));
                if (eqFree(eqs[code], date, s, e, q)) items.push(E(code, q));
              }
            }
            let status;
            if (offset < 0 || (offset === 0 && e <= nowMin - 30)) {
              const r = rand();
              const faulty = items.some((i) => ['EQ-OSC', 'EQ-3DP'].includes(i.eq.code));
              if (r < 0.06) status = 'rejected';
              else if (r < 0.12) status = 'cancelled';
              else if (r < 0.14) status = 'cancelled';
              else if (items.length && chance(faulty ? 0.14 : 0.02)) status = 'damaged';
              else if (items.length && chance(0.07)) status = 'returned_late';
              else status = 'completed';
              addBooking({ user, lab, items, date, s, e, status, purpose_type: ptype, purpose, attendees, noShow: r >= 0.12 && r < 0.14, damageNote: faulty ? pick(['Probe channel not responding', 'Nozzle clogged / extruder jam', 'Display flickering', 'Cracked casing']) : 'Broken connector', damageStatus: offset > -14 && chance(0.5) ? 'open' : 'resolved' });
              if (status === 'returned_late') user.late_return_count++;
            } else {
              const r = rand();
              status = r < 0.74 ? (offset <= 1 ? 'reserved' : 'approved') : r < 0.9 ? 'pending' : 'cancelled';
              addBooking({ user, lab, items, date, s, e, status, purpose_type: ptype, purpose, attendees, cancelledWhilePending: status === 'cancelled' && chance(0.4), createdAt: offset === 0 ? addMinutes(nowStr, -randint(120, 2000)) : undefined });
            }
            break;
          }
        }
      }

      // Equipment-only loans
      const loans = Math.floor(growth * wdFactor * futureFactor * 3.2 + rand());
      for (let n = 0; n < loans; n++) {
        const [code, lo, hi, maxH] = pick(EQUIPMENT_ONLY);
        if (offset === 0 && code === 'EQ-ARD-UNO') continue;
        const eq = eqs[code];
        const startH = weighted(hourWeights);
        const s = startH * 60;
        const e = Math.min(20 * 60, s + 60 * randint(1, maxH));
        if (e <= s) continue;
        if (offset === 0 && !(e <= nowMin - 30 || s >= nowMin + 60)) continue;
        const q = Math.min(eq.total, randint(lo, hi));
        if (!eqFree(eq, date, s, e, q)) {
          if (offset < 0 && chance(0.5)) insert('INSERT INTO demand_misses (resource_type, resource_id, requested_qty, available_qty, start_at, user_id, created_at) VALUES (?,?,?,?,?,?,?)', 'equipment', eq.id, q, 0, `${date}T${fromMinutes(s)}`, pick(students).id, `${addDays(date, -1)}T12:00:00`);
          continue;
        }
        const [ptype, purpose] = pick(PURPOSES[eq.dept]);
        const user = pickUser(eq.dept, false);
        let status;
        if (offset < 0 || (offset === 0 && e <= nowMin - 30)) {
          const r = rand();
          status = r < 0.07 ? 'rejected' : r < 0.13 ? 'cancelled' : chance(0.09) ? 'returned_late' : chance(code === 'EQ-DRONE' || code === 'EQ-GOPRO' ? 0.06 : 0.015) ? 'damaged' : 'completed';
          if (status === 'returned_late') user.late_return_count++;
        } else {
          const r = rand();
          status = r < 0.7 ? (offset <= 1 ? 'reserved' : 'approved') : r < 0.92 ? 'pending' : 'cancelled';
        }
        addBooking({ user, items: [E(code, q)], date, s, e, status, purpose_type: ptype, purpose, attendees: q, damageNote: 'Lens scratched / housing cracked', damageStatus: offset > -10 ? 'open' : 'resolved' });
      }
    }

    // --- Users with late-return history / restriction ---------------------------
    for (const u of users) {
      if (u.role !== 'student') continue;
      run('UPDATE users SET late_return_count = ? WHERE id = ?', Math.min(2, u.late_return_count), u.id);
    }
    run('UPDATE users SET late_return_count = 2 WHERE id = ?', sara.id);
    run('UPDATE users SET late_return_count = 3, restricted_until = ? WHERE email = ?', `${addDays(todayStr, 5)}T23:59`, 'usman.tariq@uni.edu');
    run('UPDATE users SET late_return_count = 0 WHERE id = ?', student.id);

    // --- Equipment health: frequently faulty items --------------------------------
    run(`UPDATE equipment SET maintenance_quantity = 1, last_maintenance_at = ? WHERE code = 'EQ-OSC'`, `${addDays(todayStr, -250)}T10:00`);
    run(`UPDATE equipment SET maintenance_quantity = 1, condition = 'fair', last_maintenance_at = ? WHERE code = 'EQ-3DP'`, `${addDays(todayStr, -200)}T10:00`);
    const tania = byEmail['staff@uni.edu'];
    const kamal = byEmail['kamal.uddin@uni.edu'];
    const report = (code, by, kind, sev, desc, status, daysAgo, qty = 1) =>
      insert(
        `INSERT INTO damage_reports (equipment_id, reported_by, kind, quantity, severity, description, status, resolved_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        eqs[code].id, by.id, kind, qty, sev, desc, status, status === 'resolved' ? `${addDays(todayStr, -daysAgo + 3)}T12:00:00` : null, `${addDays(todayStr, -daysAgo)}T11:30:00`,
      );
    report('EQ-OSC', tania, 'damaged', 'high', 'Channel 2 input not responding; probe compensation fails.', 'in_repair', 6);
    report('EQ-OSC', tania, 'fault', 'medium', 'Intermittent trigger instability reported by students.', 'open', 2);
    report('EQ-OSC', tania, 'fault', 'low', 'Rotary encoder skipping steps.', 'resolved', 48);
    report('EQ-3DP', kamal, 'damaged', 'medium', 'Nozzle clogging repeatedly; extruder gear worn.', 'in_repair', 9);
    report('EQ-3DP', kamal, 'fault', 'medium', 'Bed levelling sensor gives inconsistent readings.', 'open', 3);
    report('EQ-CISCO-RTR', byEmail['rafiq.islam@uni.edu'], 'fault', 'low', 'Console port loose on unit #7.', 'resolved', 35);

    // --- Maintenance windows & temporary blocks --------------------------------------
    const block = (type, id, kind, title, reason, start, end, qty, by) =>
      insert(
        `INSERT INTO resource_blocks (resource_type, resource_id, kind, title, reason, start_at, end_at, quantity, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        type, id, kind, title, reason, start, end, qty, start <= nowStr ? 'in_progress' : 'scheduled', by.id,
      );
    block('lab', labs['CSE-L3'].id, 'maintenance', 'Router firmware upgrade & re-cabling', 'Annual network rack maintenance', `${d2}T08:00`, `${d2}T13:00`, null, byEmail['rafiq.islam@uni.edu']);
    block('equipment', eqs['EQ-GOPRO'].id, 'block', 'Reserved for convocation coverage', 'University convocation media team', `${d8}T08:00`, `${d8}T20:00`, 3, byEmail['sumaiya.noor@uni.edu']);
    block('equipment', eqs['EQ-3DP'].id, 'maintenance', 'Extruder replacement & calibration', 'Recurring nozzle clogging', `${d5}T09:00`, `${d5}T13:00`, 1, kamal);

    // --- Department rule override, waitlist, notifications --------------------------
    run(`INSERT INTO rules (department_id, key, value, updated_by) VALUES (?, 'max_equipment_qty_student', '12', ?)`, dept.EEE, byEmail['coordinator@uni.edu'].id);
    run(`INSERT INTO rules (department_id, key, value, updated_by) VALUES (?, 'max_hours_student', '3', ?)`, dept.MCJ, byEmail['omar.siddiqui@uni.edu'].id);

    insert(`INSERT INTO waitlist (user_id, resource_type, resource_id, start_at, end_at, quantity, note) VALUES (?, 'equipment', ?, ?, ?, 1, ?)`, byEmail['bilal.hussain@uni.edu'].id, eqs['EQ-DRONE'].id, `${d4}T09:00`, `${d4}T12:00`, 'Need for final project B-roll');
    for (const [code, n] of [['EQ-ARD-UNO', 9], ['EQ-DSLR', 6], ['EQ-RPI4', 5], ['EQ-DRONE', 4], ['EQ-OSC', 3]]) {
      for (let i = 0; i < n; i++) {
        insert('INSERT INTO demand_misses (resource_type, resource_id, requested_qty, available_qty, start_at, user_id, created_at) VALUES (?,?,?,?,?,?,?)', 'equipment', eqs[code].id, randint(2, 10), randint(0, 3), `${addDays(todayStr, -randint(1, 60))}T14:00`, pick(students).id, `${addDays(todayStr, -randint(1, 60))}T10:00:00`);
      }
    }

    const note = (u, type, title, message, link, minsAgo, read = 0) =>
      insert('INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at) VALUES (?,?,?,?,?,?,?)', u.id, type, title, message, link, read, stamp(addMinutes(nowStr, -minsAgo)));
    note(student, 'welcome', 'Welcome to UniLab', 'Browse labs and equipment, check live availability and submit booking requests in seconds.', '/resources', 6000, 1);
    note(student, 'booking_submitted', 'Request submitted', 'Your Embedded Systems Lab request for Friday 2–4 PM is awaiting lab staff approval.', '/bookings', 180);
    note(student, 'booking_reserved', 'Booking reserved', 'Your Digital Electronics Lab booking today is reserved. Show your QR code at the lab.', '/bookings', 40);
    note(sara, 'overdue', 'Equipment overdue', 'Your 2 × ESP32 IoT Dev Kit were due yesterday at 4:00 PM. Please return them immediately.', '/bookings', 900);
    note(tania, 'approval_needed', 'New booking request', 'Ali Raza requested Embedded Systems Lab + 5 × Arduino Uno Starter Kit for Friday 2–4 PM.', '/approvals', 180);
    note(tania, 'overdue', 'Overdue return', 'ESP32 kits issued to Sara Khan have not been returned.', '/desk', 880);
    note(byEmail['coordinator@uni.edu'], 'approval_needed', 'Coordinator review needed', 'Dr. Lina Sultana requested the Power Systems Lab (requires coordinator approval).', '/approvals', 300);
    note(faculty, 'booking_approved', 'Booking confirmed', 'Your Embedded Systems Lab session on Friday 10:00–12:00 was approved automatically.', '/bookings', 2000, 1);
  });

  ensureDefaultPermissions();
  syncAvailableQuantities();
  const counts = get('SELECT (SELECT COUNT(*) FROM bookings) AS bookings, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM equipment) AS equipment');
  console.log(`[seed] Demo data ready: ${counts.users} users, ${counts.equipment} equipment types, ${counts.bookings} bookings.`);
}

// `npm run seed` → wipe and re-seed.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  resetDatabase();
  seed();
}
