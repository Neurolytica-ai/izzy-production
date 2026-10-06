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
  'common.network': { en: 'Cannot reach the server. Check your connection.', he: 'אין חיבור לשרת. בדקו את החיבור לרשת.' },
  'common.badResponse': { en: 'The server returned an unreadable response. Try again in a minute.', he: 'התקבלה תשובה לא תקינה מהשרת. נסו שוב בעוד דקה.' },
  'common.requestFailed': { en: 'Request failed ({n})', he: 'הבקשה נכשלה ({n})' },
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
  'tab.users': { en: '👥 Users', he: '👥 משתמשים' },
  'tab.log': { en: '🧾 Activity Log', he: '🧾 יומן פעולות' },

  // ---- login -------------------------------------------------------------
  'login.title': { en: 'Izzy Yogev Technologies', he: 'איזי יוגב טכנולוגיות' },
  'login.subtitle': { en: 'Production Management & Control', he: 'ניהול ובקרת ייצור' },
  'login.username': { en: 'Username', he: 'שם משתמש' },
  'login.password': { en: 'Password', he: 'סיסמה' },
  'login.signIn': { en: 'Sign in', he: 'התחבר' },
  'login.signingIn': { en: 'Signing in…', he: 'מתחבר…' },
  'login.failed': { en: 'Sign-in failed.', he: 'ההתחברות נכשלה.' },
  'login.forgot': { en: 'Forgot password?', he: 'שכחת סיסמה?' },
  'login.forgotHint': {
    en: 'To reset your password, contact your system administrator.',
    he: 'לאיפוס הסיסמה, פנה למנהל המערכת.',
  },
  'login.forgotIntro': {
    en: 'Enter your username above, and a reset link will be emailed to the address on your account.',
    he: 'הזן את שם המשתמש למעלה, וקישור לאיפוס יישלח למייל המשויך לחשבון.',
  },
  'login.forgotSend': { en: 'Send reset link', he: 'שלח קישור איפוס' },
  'login.forgotSending': { en: 'Sending…', he: 'שולח…' },
  'login.forgotSent': {
    en: 'If this account has an email address on file, a reset link was sent to it.',
    he: 'אם לחשבון זה משויכת כתובת מייל, נשלח אליה קישור איפוס.',
  },

  // ---- password reset (from the emailed link) ----------------------------
  'reset.title': { en: 'Choose a new password', he: 'בחירת סיסמה חדשה' },
  'reset.newPassword': { en: 'New password', he: 'סיסמה חדשה' },
  'reset.confirmPassword': { en: 'Confirm password', he: 'אימות סיסמה' },
  'reset.mismatch': { en: 'The passwords do not match.', he: 'הסיסמאות אינן תואמות.' },
  'reset.submit': { en: 'Set new password', he: 'קבע סיסמה חדשה' },
  'reset.success': {
    en: 'Password updated. You can sign in with it now.',
    he: 'הסיסמה עודכנה. אפשר להתחבר איתה עכשיו.',
  },
  'reset.backToLogin': { en: 'Back to sign-in', he: 'חזרה להתחברות' },

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
  'master.archived': { en: 'archived', he: 'ארכיון' },
  'master.showArchived': { en: 'Show archived projects ({n})', he: 'הצג פרויקטים בארכיון ({n})' },
  'master.closed': { en: 'closed', he: 'סגור' },
  'master.showClosed': { en: 'Show closed tickets ({n})', he: 'הצג תיקונים סגורים ({n})' },
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
  'field.proj.archived': { en: 'Archived (history only, not offered in reporting)', he: 'בארכיון (היסטוריה בלבד, לא מוצע בדיווח)' },

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
  'field.rep.closed': { en: 'Closed (not offered in reporting)', he: 'סגור (לא מוצע בדיווח)' },

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
  'report.notIdentifiedIn': { en: 'Not identified: {fields}', he: 'לא זוהה: {fields}' },
  'report.badDate': {
    en: 'The date is incomplete — fill in a full date before saving',
    he: 'התאריך אינו מלא — יש להשלים תאריך מלא לפני השמירה',
  },
  'report.daySubmitted': { en: 'Day submitted — {n} rows', he: 'היום הוכנס — {n} שורות' },
  'report.nothingToSubmit': { en: 'Nothing to submit for this date', he: 'אין מה להכניס עבור תאריך זה' },
  'report.submitFailed': { en: 'Submit failed', he: 'ההכנסה נכשלה' },
  'report.deleteRow': {
    en: 'Delete this row? {emp} · {hours}h · {date}',
    he: "למחוק שורה זו? {emp} · {hours} שע' · {date}",
  },
  'report.repairLabel': { en: 'Repair {n}', he: 'תיקון {n}' },
  'report.overTarget': {
    en: '{nick} would have {total} hours on {date}, above the {target}-hour standard. Confirm to continue.',
    he: 'ל{nick} יהיו {total} שעות בתאריך {date}, מעל התקן של {target} שעות. לאשר ולהמשיך?',
  },
  'report.dayTotals': { en: '{n} rows · {h} hours reported', he: '{n} שורות · {h} שעות דווחו' },
  'report.dup.emp': {
    en: 'New row with this employee and department',
    he: 'שורה חדשה עם אותו עובד ומחלקה',
  },
  'report.dup.proj': {
    en: 'New row with this project/ticket and department',
    he: 'שורה חדשה עם אותו פרויקט/תיקון ומחלקה',
  },
  'report.summary.button': { en: '📊 Hours summary', he: '📊 סיכום שעות' },
  'report.summary.title': { en: 'Hours summary — {date}', he: 'סיכום שעות — {date}' },
  'report.summary.close': { en: 'Close', he: 'סגור' },
  'report.summary.kpi': {
    en: '{n} employees · {h} hours reported of {std} standard',
    he: '{n} עובדים · דווחו {h} שעות מתוך {std} שעות תקן',
  },
  'report.summary.over': { en: 'Over standard', he: 'חריגה' },
  'report.summary.missing': { en: 'Not reported (0)', he: 'לא דווח (0)' },
  'report.summary.under': { en: 'Missing hours', he: 'חסרות שעות' },
  'report.summary.ok': { en: 'OK', he: 'תקין' },
  'report.summary.onlyExceptions': { en: 'Exceptions only', he: 'חריגים בלבד' },
  'report.summary.th.reported': { en: 'Reported', he: 'שעות מדווחות' },
  'report.summary.th.standard': { en: 'Standard', he: 'שעות תקן' },
  'report.summary.th.diff': { en: 'Difference', he: 'הפרש' },
  'report.summary.th.status': { en: 'Status', he: 'סטטוס' },
  'report.summary.none': { en: 'No exceptions for this day', he: 'אין חריגים ביום זה' },
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

  // ---- Excel import (cards from the prototype's import tab) ----------------
  'import.card.employees': { en: 'Employee list', he: 'רשימת עובדים' },
  'import.desc.employees': { en: "Employee #, name, nickname, status, contractor", he: "מס' עובד, שם, כינוי, סטטוס, קבלן" },
  'import.card.projects': { en: 'Project list', he: 'רשימת פרויקטים' },
  'import.desc.projects': { en: 'Parent project, name, nickname', he: 'פרויקט אב, שם, כינוי' },
  'import.card.departments': { en: 'Department list', he: 'רשימת מחלקות' },
  'import.desc.departments': { en: 'Department #, name', he: "מס' מחלקה, שם" },
  'import.card.standard': { en: 'Standard hours / costing', he: 'שעות תקן / תמחור' },
  'import.desc.standard': { en: 'Parent project, hours per department, total', he: 'פרויקט אב, שעות לפי מחלקה, סה"כ' },
  'import.card.attendance': { en: 'Attendance clock (Lumen)', he: 'שעון נוכחות (לומן)' },
  'import.desc.attendance': { en: 'Employee #, date, total hours', he: 'מס עובד, תאריך, סה"כ שעות' },
  'import.card.repairs': { en: 'Repairs', he: 'תיקונים' },
  'import.card.history': { en: 'Hours reports (דיווחי שעות)', he: 'דיווחי שעות' },
  'import.history.creates': {
    en: 'Also creates from the history: {emp} former employees (inactive), {proj} old projects (archived), {fix} repair tickets',
    he: 'ייווצרו גם מתוך ההיסטוריה: {emp} עובדים לשעבר (לא פעילים), {proj} פרויקטים ישנים (בארכיון), {fix} כרטיסי תיקון',
  },
  'import.desc.repairs': { en: 'Repair #, customer, entry date, model', he: "מס' תיקון, לקוח, תאריך כניסה, דגם" },
  'import.card.reports': { en: 'Bulk hours reports', he: 'קובץ דיווח שעות (בכמות)' },
  'import.desc.reports': { en: 'Load historical reports in bulk', he: 'טעינת דיווחים היסטוריים בכמות' },

  'import.card.workbook': {
    en: 'Hours workbook — employees, projects, departments, repairs, hours reports',
    he: 'קובץ דיווח שעות — עובדים, פרויקטים, מחלקות, תיקונים, דיווחי שעות',
  },
  'import.desc.workbook': {
    en: 'The office workbook (.xlsm): sheets Employees, ProjectNum, Departments, repairs, דיווחי שעות — everything in one load. Re-uploading the updated file adds only what is new.',
    he: 'קובץ האקסל של המשרד (.xlsm): גיליונות Employees, ProjectNum, Departments, repairs, דיווחי שעות — הכל בטעינה אחת. טעינה חוזרת של הקובץ המעודכן מוסיפה רק את החדש.',
  },
  'import.readingWorkbook': {
    en: 'Uploading and reading the workbook… this can take a minute or two',
    he: 'מעלה וקורא את הקובץ… הפעולה עשויה לקחת דקה-שתיים',
  },
  'import.reading': { en: 'Reading file…', he: 'קורא קובץ…' },
  'import.stage.extract': {
    en: 'Reading the file on this computer…',
    he: 'קורא את הקובץ במחשב זה…',
  },
  'import.stage.server': {
    en: 'Checking the data against the system…',
    he: 'בודק את הנתונים מול המערכת…',
  },
  'import.elapsed': { en: '{s}s', he: '{s} שניות' },
  'import.stage.cancel': { en: 'Stop', he: 'עצור' },

  // Pending upload kept on the server (client feedback round 4 #2)
  'import.draft.pending': {
    en: 'Waiting for approval: {file} · uploaded at {at} · kept until {until}',
    he: 'ממתין לאישור: {file} · הועלה ב-{at} · נשמר עד {until}',
  },
  'import.draft.cancel': { en: '✕ Cancel this upload', he: '✕ בטל טעינה זו' },
  'import.draft.cancelConfirm': {
    en: 'Cancel the pending upload? Nothing from it has been saved, and you can upload a file again.',
    he: 'לבטל את הטעינה הממתינה? דבר ממנה לא נשמר, ואפשר לטעון קובץ מחדש.',
  },
  'import.draft.cancelled': { en: 'Upload cancelled', he: 'הטעינה בוטלה' },
  'import.draft.blocked': {
    en: 'An upload is waiting for approval — approve it or cancel it to upload another file.',
    he: 'טעינה ממתינה לאישור — יש לאשר או לבטל אותה כדי לטעון קובץ אחר.',
  },
  'import.draft.expired': {
    en: 'The pending upload has expired — please upload the file again.',
    he: 'תוקף הטעינה הממתינה פג — יש לטעון את הקובץ מחדש.',
  },

  // New hours rows + duplication in the review (client feedback round 4 #3)
  'import.rows.title': { en: 'New hours rows ({n})', he: 'שורות שעות חדשות ({n})' },
  'import.rows.truncated': {
    en: 'Showing the newest {shown} of {n}.',
    he: 'מוצגות {shown} השורות האחרונות מתוך {n}.',
  },
  'import.rows.hint': {
    en: 'Select rows and duplicate them — a copy keeps everything except the employee, which you fill in.',
    he: 'יש לסמן שורות ולשכפל אותן — העותק שומר הכל מלבד העובד, אותו יש למלא.',
  },
  'import.rows.filter': { en: 'Filter rows…', he: 'סינון שורות…' },
  'import.rows.duplicate': { en: '⧉ Duplicate selected ({n})', he: '⧉ שכפל נבחרות ({n})' },
  'import.rows.selectAll': { en: 'Select all shown rows', he: 'סמן את כל השורות המוצגות' },
  'import.rows.select': { en: 'Select row', he: 'סמן שורה' },
  'import.rows.copy': { en: 'copy', he: 'עותק' },
  'import.rows.remove': { en: 'Remove this duplicated row', he: 'הסר שורה משוכפלת' },
  'import.rows.pickEmployee': { en: 'Employee…', he: 'עובד…' },
  'import.rows.needEmployee': {
    en: '{n} duplicated rows still need an employee',
    he: '{n} שורות משוכפלות עדיין ללא עובד',
  },
  'import.rows.none': { en: 'No new hours rows in this file.', he: 'אין שורות שעות חדשות בקובץ.' },
  'import.review.dup': { en: ' · {n} duplicated rows', he: ' · {n} שורות משוכפלות' },
  'import.review.intro': {
    en: 'Review the changes below. Nothing is saved until you confirm.',
    he: 'יש לעבור על השינויים שלהלן. דבר לא נשמר עד לאישור.',
  },
  'import.review.summary': {
    en: 'Will add {add}, update {upd}, remove {rem}',
    he: 'יתווספו {add} · יעודכנו {upd} · יוסרו {rem}',
  },
  'import.review.confirm': {
    en: 'Apply the import? {add} records will be added, {upd} updated and {rem} removed (history is kept).',
    he: 'לבצע את הטעינה? יתווספו {add} רשומות, יעודכנו {upd} ויוסרו {rem} (ההיסטוריה נשמרת).',
  },
  'import.tag.remove': { en: '{n} not in file', he: '{n} לא בקובץ' },
  'import.list.added': { en: 'To be added ({n})', he: 'יתווספו ({n})' },
  'import.list.updated': { en: 'To be updated ({n})', he: 'יעודכנו ({n})' },
  'import.list.removals': {
    en: 'In the system but not in the file ({n}) — tick to remove',
    he: 'קיימים במערכת אך לא בקובץ ({n}) — סמנו להסרה',
  },
  'import.list.errors': { en: 'Rows that will be skipped ({n})', he: 'שורות שידולגו ({n})' },
  'import.remove.all': { en: 'Remove all ({n} of {total} selected)', he: 'הסר הכל ({n} מתוך {total} מסומנים)' },
  'import.remove.warn.newer': {
    en: '⚠ numbered above everything in the file — probably added after this file was saved',
    he: '⚠ מספר גבוה מכל מה שבקובץ — כנראה נוסף אחרי שהקובץ נשמר',
  },
  'import.remove.warn.recent': {
    en: '⚠ hours reported recently (last: {date})',
    he: '⚠ דווחו שעות לאחרונה (אחרון: {date})',
  },
  'import.remove.meaning.employees': {
    en: 'A removed employee is marked inactive: no longer offered in hours reporting, past reports are kept.',
    he: 'עובד שיוסר יסומן כלא פעיל: לא יוצע יותר בדיווח שעות, הדיווחים הקודמים נשמרים.',
  },
  'import.remove.meaning.projects': {
    en: 'A removed project is archived: no longer offered in hours reporting, past reports are kept.',
    he: 'פרויקט שיוסר יועבר לארכיון: לא יוצע יותר בדיווח שעות, הדיווחים הקודמים נשמרים.',
  },
  'import.remove.meaning.repairs': {
    en: 'A removed ticket is closed: no longer offered in hours reporting, past reports are kept.',
    he: 'תיקון שיוסר ייסגר: לא יוצע יותר בדיווח שעות, הדיווחים הקודמים נשמרים.',
  },
  'import.field.name': { en: 'name', he: 'שם' },
  'import.field.nick': { en: 'nickname', he: 'כינוי' },
  'import.field.active': { en: 'active', he: 'פעיל' },
  'import.field.contractor': { en: 'contractor', he: 'קבלן' },
  'import.field.client': { en: 'customer', he: 'לקוח' },
  'import.field.overhead': { en: 'overhead', he: 'תקורה' },
  'import.field.archived': { en: 'archived', he: 'בארכיון' },
  'import.field.closed': { en: 'closed', he: 'סגור' },
  'import.field.num': { en: 'number', he: 'מספר' },
  'import.doneDetail': {
    en: '✓ Applied ({n} records). Removed: {emp} employees, {proj} projects, {fix} tickets.',
    he: '✓ עודכן בהצלחה ({n} רשומות). הוסרו: {emp} עובדים, {proj} פרויקטים, {fix} תיקונים.',
  },
  'import.tag.new': { en: '{n} new', he: '{n} חדשים' },
  'import.tag.updated': { en: '{n} updated', he: '{n} עדכון' },
  'import.tag.unchanged': { en: '{n} unchanged', he: '{n} ללא שינוי' },
  'import.tag.invalid': { en: '{n} invalid', he: '{n} שגויות' },
  'import.rowN': { en: 'Row {n}: ', he: 'שורה {n}: ' },
  'import.moreErrors': { en: '…and {n} more', he: '…ועוד {n}' },
  'import.confirm': { en: '✓ Confirm and apply', he: '✓ אשר ועדכן' },
  'import.done': { en: '✓ Applied ({n} records)', he: '✓ עודכן בהצלחה ({n} רשומות)' },
  'import.failed': { en: 'Import failed', he: 'הטעינה נכשלה' },
  'import.roleNote': {
    en: 'Your role is {role}, which can view this screen but not load files. Importing requires manager or admin.',
    he: 'התפקיד שלך הוא {role}, שיכול לצפות במסך זה אך לא לטעון קבצים. טעינה דורשת הרשאת מנהל או אדמין.',
  },

  // ---- Excel export ---------------------------------------------------------
  'common.exportExcel': { en: '⬇️ Export to Excel', he: '⬇️ ייצוא לאקסל' },

  // ---- attendance cross-check ----------------------------------------------
  'coverage.hint': {
    en: 'Clock hours vs reported hours; a gap beyond ±1h is flagged',
    he: 'שעון נוכחות מול שעות מדווחות; פער מעל ±1 ש׳ מסומן',
  },
  'coverage.kpi.completed': { en: 'Completed target', he: 'השלימו יעד' },
  'coverage.kpi.withClock': { en: 'With clock entry', he: 'עם רישום שעון' },
  'coverage.kpi.flagged': { en: 'Flagged gaps (>±1h)', he: 'פערים חריגים (>±1 ש׳)' },
  'coverage.th.employee': { en: 'Employee', he: 'עובד' },
  'coverage.th.type': { en: 'Type', he: 'סוג' },
  'coverage.th.status': { en: 'Status', he: 'סטטוס' },
  'coverage.th.reported': { en: 'Reported', he: 'מדווח' },
  'coverage.th.target': { en: 'Target', he: 'תקן' },
  'coverage.th.clock': { en: 'Clock', he: 'שעון' },
  'coverage.th.variance': { en: 'Variance', he: 'פער' },
  'coverage.status.complete': { en: 'complete', he: 'הושלם' },
  'coverage.status.partial': { en: 'partial', he: 'חלקי' },
  'coverage.status.notYet': { en: 'not yet', he: 'טרם' },
  'coverage.contractor': { en: 'contractor', he: 'קבלן' },
  'coverage.badHours': { en: 'Clock hours must be 0–24', he: 'שעות שעון חייבות להיות 0–24' },
  'coverage.empty': { en: 'No active employees', he: 'אין עובדים פעילים' },

  // ---- dashboard -------------------------------------------------------------
  'dash.period': { en: 'Period', he: 'תקופה' },
  'dash.period.day': { en: 'Day', he: 'יום' },
  'dash.period.week': { en: 'Last week', he: 'שבוע אחרון' },
  'dash.period.month': { en: 'Month', he: 'חודש' },
  'dash.period.all': { en: 'All dates', he: 'כל התאריכים' },
  'dash.client': { en: 'Customer', he: 'לקוח' },
  'dash.allClients': { en: 'All customers', he: 'כל הלקוחות' },
  'dash.kpi.totalHours': { en: 'Total reported hours', he: 'סה"כ שעות מדווחות' },
  'dash.kpi.prodOverhead': { en: 'Productive / overhead', he: 'יחס יצרני / תקורה' },
  'dash.kpi.overruns': { en: 'Projects over standard', he: 'פרויקטים בחריגת תקן' },
  'dash.kpi.savings': { en: 'Projects with savings', he: 'פרויקטים בחיסכון' },
  'dash.budgetTitle': { en: 'Budget vs actual (standard hours)', he: 'מתוכנן מול בפועל (שעות תקן)' },
  'dash.th.project': { en: 'Project', he: 'פרויקט' },
  'dash.th.client': { en: 'Customer', he: 'לקוח' },
  'dash.th.planned': { en: 'Planned', he: 'מתוכנן' },
  'dash.th.actual': { en: 'Actual', he: 'בפועל' },
  'dash.th.variance': { en: 'Variance', he: 'פער' },
  'dash.th.utilization': { en: 'Utilization', he: 'ניצול' },
  'dash.noBudgetRows': {
    en: 'No projects with standard hours in this period',
    he: 'אין פרויקטים עם שעות תקן בתקופה זו',
  },
  'dash.noStandardNote': {
    en: '{n} more projects have reported hours but no standard defined',
    he: 'עוד {n} פרויקטים עם שעות מדווחות אך ללא שעות תקן מוגדרות',
  },
  'dash.bucketsTitle': { en: 'Hours by department bucket', he: 'שעות לפי קטגוריית מחלקה' },
  'dash.noData': { en: 'No data', he: 'אין נתונים' },

  // ---- activity log --------------------------------------------------------
  'log.th.when': { en: 'When', he: 'זמן' },
  'log.th.user': { en: 'User', he: 'משתמש' },
  'log.th.action': { en: 'Action', he: 'פעולה' },
  'log.th.entity': { en: 'Record', he: 'רשומה' },
  'log.th.detail': { en: 'Detail', he: 'פירוט' },
  'log.filter.allActions': { en: 'All actions', he: 'כל הפעולות' },
  'log.searchPlaceholder': { en: 'search the details…', he: 'חיפוש בפירוט…' },
  'log.kpi.entries': { en: 'Entries (filtered)', he: 'רשומות (מסוננות)' },
  'log.clear': { en: '🗑 Clear log', he: '🗑 נקה יומן' },
  'log.clearConfirm': {
    en: 'Clear the entire activity log? This cannot be undone (the clearing itself is logged).',
    he: 'לנקות את כל יומן הפעולות? פעולה זו אינה הפיכה (הניקוי עצמו נרשם ביומן).',
  },
  'log.cleared': { en: 'Activity log cleared', he: 'יומן הפעולות נוקה' },
  'log.clearFailed': { en: 'Clear failed', he: 'הניקוי נכשל' },
  'log.empty': { en: 'No log entries match', he: 'אין רשומות יומן תואמות' },
  'log.system': { en: 'system', he: 'מערכת' },

  // ---- users (admin account management) ---------------------------------
  'entity.user': { en: 'user', he: 'משתמש' },
  'role.reporter': { en: 'Reporter', he: 'מדווח' },
  'role.manager': { en: 'Manager', he: 'מנהל' },
  'role.admin': { en: 'Admin', he: 'מנהל מערכת' },
  'users.title': { en: 'Users', he: 'משתמשים' },
  'users.subtitle': {
    en: 'Create and manage the people who can sign in. Admin only.',
    he: 'יצירה וניהול של המשתמשים שיכולים להתחבר. למנהל מערכת בלבד.',
  },
  'users.add': { en: 'Add user', he: 'הוספת משתמש' },
  'users.addTitle': { en: 'Add user', he: 'הוספת משתמש' },
  'users.editTitle': { en: 'Edit user — {name}', he: 'עריכת משתמש — {name}' },
  'users.none': { en: 'No users yet', he: 'אין עדיין משתמשים' },
  'users.resetPassword': { en: 'Reset password', he: 'איפוס סיסמה' },
  'users.resetTitle': { en: 'Reset password — {name}', he: 'איפוס סיסמה — {name}' },
  'users.newPassword': { en: 'New password', he: 'סיסמה חדשה' },
  'users.passwordReset': { en: 'Password reset', he: 'הסיסמה אופסה' },
  'users.deleteConfirm': {
    en: 'Delete user {name}? Their history stays; they can no longer sign in.',
    he: 'למחוק את המשתמש {name}? ההיסטוריה נשמרת; הוא לא יוכל להתחבר יותר.',
  },
  'users.never': { en: 'never', he: 'מעולם לא' },
  'th.username': { en: 'Username', he: 'שם משתמש' },
  'th.displayName': { en: 'Display name', he: 'שם לתצוגה' },
  'th.role': { en: 'Role', he: 'תפקיד' },
  'th.linkedEmployee': { en: 'Linked employee #', he: 'מס׳ עובד מקושר' },
  'th.status': { en: 'Status', he: 'סטטוס' },
  'th.lastLogin': { en: 'Last sign-in', he: 'התחברות אחרונה' },
  'th.email': { en: 'Email', he: 'מייל' },
  'users.active': { en: 'Active', he: 'פעיל' },
  'users.inactive': { en: 'Disabled', he: 'מושבת' },
  'field.user.username': { en: 'Username', he: 'שם משתמש' },
  'field.user.usernameHint': {
    en: 'At least 3 characters, no spaces. Cannot be changed later.',
    he: 'לפחות 3 תווים, ללא רווחים. לא ניתן לשינוי לאחר מכן.',
  },
  'field.user.password': { en: 'Password', he: 'סיסמה' },
  'field.user.passwordHint': { en: 'At least 8 characters.', he: 'לפחות 8 תווים.' },
  'field.user.displayName': { en: 'Display name', he: 'שם לתצוגה' },
  'field.user.role': { en: 'Role', he: 'תפקיד' },
  'field.user.empNum': { en: 'Linked employee number', he: 'מספר עובד מקושר' },
  'field.user.empNumHint': {
    en: 'Optional — ties this login to an employee record.',
    he: 'לא חובה — מקשר את ההתחברות לרשומת עובד.',
  },
  'field.user.email': { en: 'Email', he: 'מייל' },
  'field.user.emailHint': {
    en: 'Optional — password-reset links are sent here.',
    he: 'לא חובה — קישורי איפוס סיסמה נשלחים לכתובת זו.',
  },
  'field.user.active': { en: 'Active', he: 'פעיל' },

  // ---- placeholder (unbuilt tabs) ---------------------------------------
  'placeholder.notBuilt': { en: 'Not built yet — Phase {phase}: {what}.', he: 'טרם נבנה — שלב {phase}: {what}.' },
  'placeholder.what.2': { en: 'Reports API and the hours-entry grid', he: 'ממשק הדיווחים וטבלת הזנת השעות' },
  'placeholder.what.3': { en: 'Server-side Excel import and export', he: 'ייבוא וייצוא אקסל בצד השרת' },
  'placeholder.what.4': {
    en: 'Attendance cross-check and dashboard',
    he: 'הצלבת נוכחות ודאשבורד',
  },
  'placeholder.whatDefault': { en: 'in progress', he: 'בתהליך' },
  'placeholder.behind': {
    en: 'The API and database behind this screen already exist and are tested; only the interface is outstanding.',
    he: 'הממשק והמסד שמאחורי מסך זה כבר קיימים ונבדקו; רק הממשק החזותי נותר.',
  },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;
