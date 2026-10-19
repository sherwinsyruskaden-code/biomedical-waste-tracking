/** Mirrors the API's rule (apps/api: MIN_PASSWORD_LENGTH). The server validates too. */
export const MIN_PASSWORD_LENGTH = 4;
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters`;
export const passwordIssue = (p: string) => (p.length < MIN_PASSWORD_LENGTH ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` : null);
