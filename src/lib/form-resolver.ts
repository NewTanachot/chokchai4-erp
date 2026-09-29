/** react-hook-form resolver wrapper: validation messages (Thai, from shared zod schemas) in the page's language. */
import type { Resolver } from "react-hook-form";
import { lang, tr } from "./i18n";

function localize(errors: unknown): void {
  if (!errors || typeof errors !== "object") return;
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (key === "ref" || !value || typeof value !== "object") continue;
    const e = value as { message?: unknown };
    if (typeof e.message === "string") e.message = tr(e.message);
    localize(value);
  }
}

/** Wraps a resolver (any of its type parameters) so its error messages are translated. */
export function translatedResolver<R extends Resolver<any, any, any>>(resolver: R): R {
  if (lang === "th") return resolver;
  const wrapped: Resolver<any, any, any> = async (values, context, options) => {
    const result = await resolver(values, context, options);
    localize(result.errors);
    return result;
  };
  return wrapped as R;
}
