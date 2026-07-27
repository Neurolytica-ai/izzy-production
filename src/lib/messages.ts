/**
 * User-facing message catalogue.
 *
 * Every string a user can see lives here in both English and Hebrew. The active
 * language comes from UI_LANG in .env (default: en, so the developer can read the
 * output; the end users at Izzy Yogev are Hebrew-speaking, so production runs
 * UI_LANG=he).
 *
 * Two rules make the switch safe rather than a rewrite:
 *
 *   1. API responses always carry a stable machine-readable `error` code
 *      alongside the human message. Clients and tests key off the code, never
 *      the text, so translating cannot break them.
 *   2. Nothing user-facing is written as a literal string anywhere else in the
 *      codebase. If it is not in this file, it does not get shown to a user.
 *
 * The language is resolved once at startup, so changing UI_LANG needs a restart.
 * That is deliberate: schema validation messages are built when modules load, and
 * a per-request language would mean threading a locale through every Zod schema
 * for no benefit in a single-tenant internal tool.
 */
import { config } from './config.ts';

export type Lang = 'en' | 'he';

interface Entry {
  en: string;
  he: string;
}

export const MSG = {
  // ---- auth / permissions ------------------------------------------------
  'auth.required': {
    en: 'Sign-in required',
    he: 'נדרשת התחברות',
  },
  'auth.expired': {
    en: 'Your session has expired. Please sign in again.',
    he: 'פג תוקף ההתחברות. יש להתחבר מחדש.',
  },
  'auth.inactive': {
    en: 'This account is not active',
    he: 'החשבון אינו פעיל',
  },
  'auth.badCredentials': {
    en: 'Incorrect username or password',
    he: 'שם משתמש או סיסמה שגויים',
  },
  'auth.throttled': {
    en: 'Too many sign-in attempts. Try again in ten minutes.',
    he: 'יותר מדי ניסיונות התחברות. נסה שוב בעוד עשר דקות.',
  },
  'auth.forbidden': {
    en: 'You do not have permission for this action',
    he: 'אין הרשאה לפעולה זו',
  },

  // ---- generic request / record -----------------------------------------
  'error.notFound': {
    en: 'Record not found',
    he: 'הרשומה לא נמצאה',
  },
  'error.invalidInput': {
    en: 'Invalid input',
    he: 'קלט לא תקין',
  },
  'error.badRequest': {
    en: 'Invalid request',
    he: 'הבקשה אינה תקינה',
  },
  'error.internal': {
    en: 'System error. Try again, or contact an administrator.',
    he: 'שגיאת מערכת. נסה שוב או פנה למנהל המערכת.',
  },
  'error.apiRouteMissing': {
    en: 'No such API route',
    he: 'נתיב API לא קיים',
  },

  // ---- identifiers and payloads -----------------------------------------
  'key.missing': {
    en: 'Missing or invalid identifier',
    he: 'מזהה חסר או לא תקין',
  },
  'key.invalid': {
    en: 'Invalid identifier',
    he: 'מזהה לא תקין',
  },
  'body.empty': {
    en: 'No data supplied',
    he: 'לא נשלחו נתונים',
  },
  'body.noFields': {
    en: 'No fields to update',
    he: 'לא נשלחו שדות לעדכון',
  },
  'body.tooLarge': {
    en: 'The file or request is too large',
    he: 'הקובץ או הבקשה גדולים מדי',
  },
  'body.notJson': {
    en: 'Request body is not valid JSON',
    he: 'תוכן הבקשה אינו JSON תקין',
  },
  'body.badEncoding': {
    en: 'Content encoding is not supported',
    he: 'קידוד התוכן אינו נתמך',
  },

  // ---- database constraint violations -----------------------------------
  'db.duplicate': {
    en: 'A record with this number already exists',
    he: 'רשומה עם מספר זה כבר קיימת',
  },
  'db.referenced': {
    en: 'Cannot do this: other records still reference this one',
    he: 'לא ניתן לבצע: קיימות רשומות המקושרות לרשומה זו',
  },
  'db.checkFailed': {
    en: 'The data does not satisfy the system rules',
    he: 'הנתונים אינם עומדים בכללי המערכת',
  },
  'db.missingRequired': {
    en: 'A required field is missing',
    he: 'חסר שדה חובה',
  },
  'db.badFormat': {
    en: 'Invalid data format',
    he: 'פורמט נתונים שגוי',
  },

  // ---- field validation --------------------------------------------------
  'field.required': {
    en: 'This field is required',
    he: 'שדה חובה',
  },
  'field.positiveNumber': {
    en: 'Must be a positive number',
    he: 'מספר חייב להיות חיובי',
  },
  'field.dateFormat': {
    en: 'Date must be in YYYY-MM-DD format',
    he: 'תאריך חייב להיות בפורמט YYYY-MM-DD',
  },
  'field.passwordTooShort': {
    en: 'Password must be at least {n} characters',
    he: 'הסיסמה חייבת להכיל לפחות {n} תווים',
  },
  'field.usernameTooShort': {
    en: 'Username is too short',
    he: 'שם משתמש קצר מדי',
  },
  'field.usernameNoSpaces': {
    en: 'Username must not contain spaces',
    he: 'שם משתמש ללא רווחים',
  },

  // ---- account safety rails ---------------------------------------------
  'user.noSelfDeactivate': {
    en: 'You cannot deactivate the account you are signed in with',
    he: 'לא ניתן להשבית את החשבון שאיתו אתה מחובר',
  },
  'user.noSelfDemote': {
    en: 'You cannot remove your own administrator role',
    he: 'לא ניתן להסיר לעצמך הרשאות מנהל',
  },
  'user.noSelfDelete': {
    en: 'You cannot delete the account you are signed in with',
    he: 'לא ניתן למחוק את החשבון שאיתו אתה מחובר',
  },
  'user.lastAdmin': {
    en: 'At least one active administrator must remain',
    he: 'חייב להישאר לפחות מנהל מערכת פעיל אחד',
  },
} as const satisfies Record<string, Entry>;

export type MessageKey = keyof typeof MSG;

/** Resolved once — see the note at the top of this file. */
const LANG: Lang = config.UI_LANG;

export function t(key: MessageKey, lang: Lang = LANG): string {
  return MSG[key][lang];
}

/** Same as t(), with {placeholder} substitution. */
export function tf(
  key: MessageKey,
  params: Record<string, string | number>,
  lang: Lang = LANG
): string {
  return Object.entries(params).reduce<string>(
    (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)),
    t(key, lang)
  );
}

/* ------------------------------------------------------------------------ */
/* Activity log vocabulary                                                  */
/*                                                                          */
/* activity_log.action and .entity store these stable CODES, never display   */
/* text. The prototype wrote Hebrew strings straight into its log, which     */
/* would leave a permanent mix of languages in the audit history the moment  */
/* anything was translated — and makes the log unfilterable by action type.  */
/* Labels are resolved for display only.                                     */
/* ------------------------------------------------------------------------ */

export const ACTION = {
  login: 'login',
  logout: 'logout',
  loginFailed: 'login.failed',
  masterAdd: 'master.add',
  masterEdit: 'master.edit',
  masterDelete: 'master.delete',
  reportAdd: 'report.add',
  reportEdit: 'report.edit',
  reportDelete: 'report.delete',
  attendanceSet: 'attendance.set',
  attendanceClear: 'attendance.clear',
  submitDay: 'day.submit',
  import: 'import',
  userAdd: 'user.add',
  userEdit: 'user.edit',
  userDelete: 'user.delete',
  passwordReset: 'password.reset',
  logCleared: 'log.cleared',
} as const;

export type ActionCode = (typeof ACTION)[keyof typeof ACTION];

const ACTION_LABELS: Record<ActionCode, Entry> = {
  'login': { en: 'Sign in', he: 'התחברות' },
  'logout': { en: 'Sign out', he: 'התנתקות' },
  'login.failed': { en: 'Failed sign-in attempt', he: 'ניסיון התחברות שנכשל' },
  'master.add': { en: 'Master data added', he: 'הוספה למאסטר' },
  'master.edit': { en: 'Master data edited', he: 'עריכת מאסטר' },
  'master.delete': { en: 'Master data deleted', he: 'מחיקה ממאסטר' },
  'report.add': { en: 'Hours reported', he: 'הוספת דיווח' },
  'report.edit': { en: 'Report edited', he: 'עריכת דיווח' },
  'report.delete': { en: 'Report deleted', he: 'מחיקת דיווח' },
  'attendance.set': { en: 'Clock hours updated', he: 'עדכון נוכחות' },
  'attendance.clear': { en: 'Clock hours cleared', he: 'מחיקת נוכחות' },
  'day.submit': { en: 'Day submitted to archive', he: 'הכנסה למאגר' },
  'import': { en: 'Excel import', he: 'טעינת אקסל' },
  'user.add': { en: 'User created', he: 'הוספת משתמש' },
  'user.edit': { en: 'User edited', he: 'עריכת משתמש' },
  'user.delete': { en: 'User deleted', he: 'מחיקת משתמש' },
  'password.reset': { en: 'Password reset', he: 'איפוס סיסמה' },
  'log.cleared': { en: 'Activity log cleared', he: 'ניקוי יומן' },
};

export const ENTITY = {
  employee: 'employee',
  project: 'project',
  department: 'department',
  standard: 'standard',
  repair: 'repair',
  user: 'user',
  report: 'report',
  attendance: 'attendance',
  day: 'day',
} as const;

export type EntityCode = (typeof ENTITY)[keyof typeof ENTITY];

const ENTITY_LABELS: Record<EntityCode, Entry> = {
  employee: { en: 'Employee', he: 'עובד' },
  project: { en: 'Project', he: 'פרויקט' },
  department: { en: 'Department', he: 'מחלקה' },
  standard: { en: 'Standard hours', he: 'שעות תקן' },
  repair: { en: 'Repair', he: 'תיקון' },
  user: { en: 'User', he: 'משתמש' },
  report: { en: 'Hours report', he: 'דיווח שעות' },
  attendance: { en: 'Attendance', he: 'נוכחות' },
  day: { en: 'Reporting day', he: 'יום דיווח' },
};

/** Falls back to the raw code for anything written by an older version. */
export function actionLabel(code: string, lang: Lang = LANG): string {
  return ACTION_LABELS[code as ActionCode]?.[lang] ?? code;
}

export function entityLabel(code: string | null, lang: Lang = LANG): string | null {
  if (!code) return null;
  return ENTITY_LABELS[code as EntityCode]?.[lang] ?? code;
}

/** The whole vocabulary, for the front end to render the log without round-trips. */
export function vocabulary(lang: Lang = LANG) {
  return {
    lang,
    actions: Object.fromEntries(
      Object.entries(ACTION_LABELS).map(([code, e]) => [code, e[lang]])
    ),
    entities: Object.fromEntries(
      Object.entries(ENTITY_LABELS).map(([code, e]) => [code, e[lang]])
    ),
  };
}
