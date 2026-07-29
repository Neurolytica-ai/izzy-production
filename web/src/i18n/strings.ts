/**
 * Front-end string catalogue (English + Hebrew).
 *
 * Every user-visible string in the React chrome lives here. The active language
 * is a RUNTIME choice (the header toggle), persisted per-browser in localStorage
 * — unlike the server's UI_LANG, which is fixed at boot. Arad asked for a live
 * toggle precisely so the Hebrew wording can be refined against user feedback.
 *
 * Hebrew is sourced from the original prototype's own labels wherever one exists
 * (📋 דיווח שעות, נתוני מאסטר, תקן, פער, ניצול, …) so users see the terms they
 * already know; the rest follows the same register.
 *
 * Rules that keep this honest (same as the server's messages.ts):
 *   - Nothing user-facing is written as a literal in a component. If it is not
 *     here, it does not get shown.
 *   - Server responses carry a stable `error` code; those messages are already
 *     translated server-side, so client code shows `err.message` for them and
 *     only the *client's own* literals live here.
 *
 * `{name}` placeholders are filled by t(key, { name: … }).
 */

export type Lang = 'en' | 'he';

type Entry = { en: string; he: string };

export const STRINGS = {
  // ---- common actions / statuses ----------------------------------------
  'common.add': { en: 'Add', he: 'הוסף' },
  'common.save': { en: 'Save', he: 'שמור' },
  'common.cancel': { en: 'Cancel', he: 'ביטול' },
  'common.delete': { en: 'Delete', he: 'מחק' },
  'common.edit': { en: 'Edit', he: 'עריכה' },
  'common.confirm': { en: 'Confirm', he: 'אישור' },
  'common.working': { en: 'Working…', he: 'מעבד…' },
  'common.saving': { en: 'Saving…', he: 'שומר…' },
  'common.loading': { en: 'Loading…', he: 'טוען…' },
  'common.failedToLoad': { en: 'Failed to load', he: 'הטעינה נכשלה' },
  'common.saved': { en: 'Saved', he: 'נשמר' },
  'common.added': { en: 'Added', he: 'נוסף' },
  'common.deleted': { en: 'Deleted', he: 'נמחק' },
  'common.saveFailed': { en: 'Save failed', he: 'השמירה נכשלה' },
  'common.deleteFailed': { en: 'Delete failed', he: 'המחיקה נכשלה' },
  'common.yes': { en: 'Yes', he: 'כן' },
  'common.no': { en: 'No', he: 'לא' },
  'common.signOut': { en: 'Sign out', he: 'התנתק' },

  // ---- app shell ---------------------------------------------------------
  'app.title': {
    en: 'Izzy Yogev Technologies — Production Management & Control',
    he: 'איזי יוגב טכנולוגיות — ניהול ובקרת ייצור',
  },
  'app.subtitle': {
    en: 'Hours reporting · attendance cross-check · standard-hours control',
    he: 'דיווח שעות · הצלבת נוכחות · בקרת שעות תקן',
  },

  // ---- navigation tabs (labels from the prototype) ----------------------
  'tab.report': { en: '📋 Hours Reporting', he: '📋 דיווח שעות' },
  'tab.archive': { en: '📚 Reports Archive', he: '📚 מאגר הדיווחים' },
  'tab.coverage': { en: '🟢 Attendance Cross-Check', he: '🟢 הצלבה שעון נוכחות' },
  'tab.dash': { en: '📊 Dashboard', he: '📊 דאשבורד' },
  'tab.import': { en: '⬆️ Excel Import', he: '⬆️ טעינת אקסלים' },
  'tab.master': { en: '🗂️ Master Data', he: '🗂️ נתוני מאסטר' },
  'tab.log': { en: '🧾 Activity Log', he: '🧾 יומן פעולות' },

  // ---- login -------------------------------------------------------------
  'login.title': { en: 'Izzy Yogev Technologies', he: 'איזי יוגב טכנולוגיות' },
  'login.subtitle': { en: 'Production Management & Control', he: 'ניהול ובקרת ייצור' },
  'login.username': { en: 'Username', he: 'שם משתמש' },
  'login.password': { en: 'Password', he: 'סיסמה' },
  'login.signIn': { en: 'Sign in', he: 'התחבר' },
  'login.signingIn': { en: 'Signing in…', he: 'מתחבר…' },
  'login.failed': { en: 'Sign-in failed.', he: 'ההתחברות נכשלה.' },

  // ---- master: KPIs ------------------------------------------------------
  'master.kpi.activeEmployees': { en: 'Active employees', he: 'עובדים פעילים' },
  'master.kpi.productiveProjects': { en: 'Productive projects', he: 'פרויקטים יצרניים' },
  'master.kpi.customers': { en: 'Customers', he: 'לקוחות' },
  'master.kpi.standardBoxes': { en: 'Standard-hours boxes', he: 'ארגזי שעות תקן' },
  'master.kpi.repairTickets': { en: 'Repair tickets', he: 'תיקונים' },

  'master.roleNote': {
    en: 'Your role is {role}, which can view master data but not change it. Editing requires manager or admin.',
    he: 'התפקיד שלך הוא {role}, שיכול לצפות בנתוני המאסטר אך לא לשנותם. עריכה דורשת הרשאת מנהל או אדמין.',
  },

  // ---- master: sections + add buttons -----------------------------------
  'master.section.employees': { en: 'Employees', he: 'עובדים' },
  'master.section.projects': { en: 'Projects', he: 'פרויקטים' },
  'master.section.departments': { en: 'Departments', he: 'מחלקות' },
  'master.section.repairs': { en: 'Repairs', he: 'תיקונים' },
  'master.section.standard': { en: 'Standard hours', he: 'שעות תקן' },
  'master.add.employee': { en: 'Add employee', he: 'הוסף עובד' },
  'master.add.project': { en: 'Add project', he: 'הוסף פרויקט' },
  'master.add.department': { en: 'Add department', he: 'הוסף מחלקה' },
  'master.add.repair': { en: 'Add repair', he: 'הוסף תיקון' },
  'master.add.box': { en: 'Add box', he: 'הוסף ארגז' },

  // ---- master: entity labels (for Add/Edit modal titles) ----------------
  'entity.employee': { en: 'employee', he: 'עובד' },
  'entity.project': { en: 'project', he: 'פרויקט' },
  'entity.department': { en: 'department', he: 'מחלקה' },
  'entity.standardBox': { en: 'standard-hours box', he: 'ארגז שעות תקן' },
  'entity.repair': { en: 'repair', he: 'תיקון' },
  'master.editTitle': { en: 'Edit {label}', he: 'עריכת {label}' },
  'master.addTitle': { en: 'Add {label}', he: 'הוספת {label}' },
  'master.deleteConfirm': { en: 'Delete {label}?', he: 'למחוק את {label}?' },

  // ---- master: table headers --------------------------------------------
  'th.number': { en: 'Number', he: 'מספר' },
  'th.name': { en: 'Name', he: 'שם' },
  'th.nickname': { en: 'Nickname', he: 'כינוי' },
  'th.subcontractor': { en: 'Subcontractor', he: 'קבלן משנה' },
  'th.target': { en: 'Target', he: 'יעד' },
  'th.customer': { en: 'Customer', he: 'לקוח' },
  'th.type': { en: 'Type', he: 'סוג' },
  'th.department': { en: 'Department', he: 'מחלקה' },
  'th.code': { en: 'Code', he: 'קוד' },
  'th.bucket': { en: 'Bucket', he: 'קטגוריה' },
  'th.box': { en: 'Box', he: 'ארגז' },
  'th.description': { en: 'Description', he: 'תיאור' },
  'th.parent': { en: 'Parent', he: 'אב' },
  'th.total': { en: 'Total', he: 'סה"כ' },
  'th.date': { en: 'Date', he: 'תאריך' },
  'th.model': { en: 'Model', he: 'דגם' },

  // ---- master: cell values / notes --------------------------------------
  'master.internal': { en: 'internal', he: 'פנימי' },
  'master.notEmployed': { en: '(not employed)', he: '(לא מועסק)' },
  'master.default': { en: '(default)', he: '(ברירת מחדל)' },
  'master.overhead': { en: 'overhead', he: 'תקורה' },
  'master.productive': { en: 'productive', he: 'יצרני' },
  'master.nonProductive': { en: 'non-productive', he: 'לא יצרני' },
  'master.nothingHere': { en: 'Nothing here yet', he: 'אין כאן עדיין' },
  'master.orphan': {
    en: '{orphans} of {boxes} boxes reference {distinct} parent projects that do not exist ({hours} standard hours). These are invisible to budget-vs-actual.',
    he: '{orphans} מתוך {boxes} ארגזים מפנים ל-{distinct} פרויקטי אב שאינם קיימים ({hours} שעות תקן). אלה אינם נראים בהשוואת תקציב מול ביצוע.',
  },

  // ---- master: field labels + hints (RecordForm) ------------------------
  'field.emp.num': { en: 'Employee number', he: 'מספר עובד' },
  'field.emp.name': { en: 'Full name', he: 'שם מלא' },
  'field.emp.nick': { en: 'Nickname (typed in the grid)', he: 'כינוי (מוקלד בטבלה)' },
  'field.emp.contractor': { en: 'Subcontractor', he: 'קבלן משנה' },
  'field.emp.contractorHint': { en: 'Leave empty for internal staff', he: 'השאר ריק לעובד פנימי' },
  'field.emp.target': { en: 'Daily target hours', he: 'יעד שעות יומי' },
  'field.emp.targetHint': {
    en: 'Leave empty for the default: 10.5 subcontractor / 8.5 internal',
    he: 'השאר ריק לברירת המחדל: 10.5 קבלן / 8.5 פנימי',
  },
  'field.emp.active': { en: 'Currently employed', he: 'מועסק כעת' },

  'field.proj.num': { en: 'Project number', he: 'מספר פרויקט' },
  'field.proj.name': { en: 'Project name', he: 'שם הפרויקט' },
  'field.proj.nick': { en: 'Nickname (typed in the grid)', he: 'כינוי (מוקלד בטבלה)' },
  'field.proj.client': { en: 'Customer', he: 'לקוח' },
  'field.proj.overhead': { en: 'Overhead (non-productive)', he: 'תקורה (לא יצרני)' },

  'field.dept.name': { en: 'Department name', he: 'שם המחלקה' },
  'field.dept.num': { en: 'Department code', he: 'קוד מחלקה' },
  'field.dept.bucket': { en: 'Standard-hours bucket', he: 'קטגוריית שעות תקן' },
  'field.dept.bucketHint': {
    en: 'Leave empty for non-productive — excluded from standard comparison',
    he: 'השאר ריק ללא-יצרני — לא ייכלל בהשוואת התקן',
  },

  'field.std.box': { en: 'Box number', he: 'מספר ארגז' },
  'field.std.name': { en: 'Box description', he: 'תיאור הארגז' },
  'field.std.parent': { en: 'Parent project', he: 'פרויקט אב' },
  'field.std.parentHint': {
    en: 'Not validated against projects — 43 existing values reference projects that do not exist',
    he: 'לא מאומת מול פרויקטים — 43 ערכים קיימים מפנים לפרויקטים שאינם קיימים',
  },
  'field.std.total': { en: 'Total standard hours', he: 'סה"כ שעות תקן' },

  'field.rep.fix': { en: 'Repair number', he: 'מספר תיקון' },
  'field.rep.client': { en: 'Customer', he: 'לקוח' },
  'field.rep.date': { en: 'Entry date', he: 'תאריך כניסה' },
  'field.rep.model': { en: 'Truck model', he: 'דגם משאית' },

  // ---- RecordForm --------------------------------------------------------
  'form.selectNone': { en: '—', he: '—' },

  // ---- report grid -------------------------------------------------------
  'report.showOneDay': { en: '📅 Show one day', he: '📅 הצג יום אחד' },
  'report.allDates': { en: '🗂 All dates', he: '🗂 כל התאריכים' },
  'report.submitDay': { en: '✓ Submit day to archive', he: '✓ הכנס למאגר · יום חדש' },
  'report.rowsAllDates': { en: '{n} rows across all dates', he: '{n} שורות בכל התאריכים' },
  'report.complete': { en: 'complete', he: 'הושלם' },
  'report.partial': { en: 'partial', he: 'חלקי' },
  'report.notReported': { en: 'not reported', he: 'לא דווח' },
  'report.submitted': { en: '✓ submitted', he: '✓ הוכנס' },
  'report.th.date': { en: 'Date', he: 'תאריך' },
  'report.th.employee': { en: 'Employee', he: 'עובד' },
  'report.th.project': { en: 'Project', he: 'פרויקט' },
  'report.th.hours': { en: 'Hours', he: 'שעות' },
  'report.th.department': { en: 'Department', he: 'מחלקה' },
  'report.th.repairNo': { en: 'Repair #', he: "מס' תיקון" },
  'report.th.projNo': { en: 'Proj #', he: "מס' פרויקט" },
  'report.th.projName': { en: 'Project name', he: 'שם הפרויקט' },
  'report.th.empNo': { en: 'Emp #', he: "מס' עובד" },
  'report.th.deptNo': { en: 'Dept #', he: "מס' מחלקה" },
  'report.th.empName': { en: 'Emp name', he: 'שם העובד' },
  'report.required': {
    en: 'Employee, project or repair, and hours are required',
    he: 'חובה למלא עובד, פרויקט או תיקון, ושעות',
  },
  'report.noRowsHint': {
    en: 'No rows for this date yet — start typing in the highlighted row.',
    he: 'אין עדיין שורות לתאריך זה — התחל להקליד בשורה המודגשת.',
  },
  'report.notIdentified': { en: 'not identified', he: 'לא זוהה' },
  'report.daySubmitted': { en: 'Day submitted — {n} rows', he: 'היום הוכנס — {n} שורות' },
  'report.nothingToSubmit': { en: 'Nothing to submit for this date', he: 'אין מה להכניס עבור תאריך זה' },
  'report.submitFailed': { en: 'Submit failed', he: 'ההכנסה נכשלה' },
  'report.deleteRow': {
    en: 'Delete this row? {emp} · {hours}h · {date}',
    he: "למחוק שורה זו? {emp} · {hours} שע' · {date}",
  },
  'report.repairLabel': { en: 'Repair {n}', he: 'תיקון {n}' },
  'report.deptSub': { en: 'dept {n}', he: 'מחלקה {n}' },
  'aria.employee': { en: 'Employee', he: 'עובד' },
  'aria.project': { en: 'Project', he: 'פרויקט' },
  'aria.department': { en: 'Department', he: 'מחלקה' },
  'aria.repairNo': { en: 'Repair number', he: 'מספר תיקון' },

  // ---- archive -----------------------------------------------------------
  'archive.from': { en: 'From', he: 'מתאריך' },
  'archive.to': { en: 'To', he: 'עד תאריך' },
  'archive.search': { en: 'Search', he: 'חיפוש' },
  'archive.searchPlaceholder': {
    en: 'employee, project, customer, department, repair #',
    he: "עובד, פרויקט, לקוח, מחלקה, מס' תיקון",
  },
  'archive.clear': { en: 'Clear', he: 'נקה' },
  'archive.kpi.rowsFiltered': { en: 'Rows (filtered)', he: 'שורות (מסוננות)' },
  'archive.kpi.totalHours': { en: 'Total hours', he: 'סה"כ שעות' },
  'archive.kpi.distinctDays': { en: 'Distinct days', he: 'ימים שונים' },
  'archive.th.date': { en: 'Date', he: 'תאריך' },
  'archive.th.employee': { en: 'Employee', he: 'עובד' },
  'archive.th.projectRepair': { en: 'Project / repair', he: 'פרויקט / תיקון' },
  'archive.th.hours': { en: 'Hours', he: 'שעות' },
  'archive.th.department': { en: 'Department', he: 'מחלקה' },
  'archive.th.customer': { en: 'Customer', he: 'לקוח' },
  'archive.th.enteredBy': { en: 'Entered by', he: 'הוזן ע"י' },
  'archive.repairPill': { en: 'repair {n}', he: 'תיקון {n}' },
  'archive.noMatch': { en: 'No rows match these filters', he: 'אין שורות התואמות את הסינון' },
  'archive.zeroRows': { en: '0 rows', he: '0 שורות' },
  'archive.range': { en: '{from}–{to} of {total}', he: '{from}–{to} מתוך {total}' },
  'archive.loadingSuffix': { en: ' · loading…', he: ' · טוען…' },
  'archive.prev': { en: '← Previous', he: 'הקודם' },
  'archive.next': { en: 'Next →', he: 'הבא' },

  // ---- placeholder (unbuilt tabs) ---------------------------------------
  'placeholder.notBuilt': { en: 'Not built yet — Phase {phase}: {what}.', he: 'טרם נבנה — שלב {phase}: {what}.' },
  'placeholder.what.2': { en: 'Reports API and the hours-entry grid', he: 'ממשק הדיווחים וטבלת הזנת השעות' },
  'placeholder.what.3': { en: 'Server-side Excel import and export', he: 'ייבוא וייצוא אקסל בצד השרת' },
  'placeholder.what.4': {
    en: 'Attendance cross-check, dashboard and activity log',
    he: 'הצלבת נוכחות, דאשבורד ויומן פעולות',
  },
  'placeholder.whatDefault': { en: 'in progress', he: 'בתהליך' },
  'placeholder.behind': {
    en: 'The API and database behind this screen already exist and are tested; only the interface is outstanding.',
    he: 'הממשק והמסד שמאחורי מסך זה כבר קיימים ונבדקו; רק הממשק החזותי נותר.',
  },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;
