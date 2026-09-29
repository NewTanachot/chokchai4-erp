/** date-fns / react-day-picker locale of the page's language (calendar month and weekday names). */
import { enGB, th } from "react-day-picker/locale";
import { lang } from "./i18n";

export const CALENDAR_LOCALE = lang === "en" ? enGB : th;
