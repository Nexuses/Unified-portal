export type Project = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  users: number;
};

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
