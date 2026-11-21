import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { siteSettings } from "../../db/schema.ts";
import { DEFAULT_SITE_CONFIG, type Service, type SiteConfig } from "./defaults.ts";

const SETTINGS_ID = "main";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function str(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max);
}

function safeUrl(value: unknown, fallback: string): string {
  const v = str(value, 500, "");
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSlot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function sanitizeService(raw: unknown, fallback: Service | undefined, index: number): Service | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const base = fallback ?? DEFAULT_SITE_CONFIG.services[0];
  const id = typeof s.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(s.id) ? s.id : `servicio-${index + 1}`;
  const icon = typeof s.icon === "string" && /^ph-[a-z0-9-]{1,40}$/.test(s.icon) ? s.icon : base.icon;
  return {
    id,
    title: str(s.title, 120, base.title) || base.title,
    subtitle: str(s.subtitle, 60, base.subtitle) || base.subtitle,
    duration: int(s.duration, 10, 240, base.duration),
    price: int(s.price, 0, 10_000_000, base.price),
    icon,
    description: str(s.description, 600, base.description),
  };
}

/**
 * Validates an incoming settings document from the admin panel. Unknown keys are dropped,
 * and the server-managed image fields are always kept from the currently stored settings.
 */
export function sanitizeConfig(input: unknown, current: SiteConfig): SiteConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SITE_CONFIG;

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => str(t, 80, "")).filter(Boolean).slice(0, 12)
    : current.tags;

  const workingDays = Array.isArray(raw.workingDays)
    ? [...new Set(raw.workingDays.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    : current.workingDays;

  const timeSlots = Array.isArray(raw.timeSlots)
    ? [...new Set(raw.timeSlots.map(normalizeSlot).filter((s): s is string => Boolean(s)))].sort().slice(0, 24)
    : current.timeSlots;

  const services = Array.isArray(raw.services)
    ? raw.services
        .slice(0, 12)
        .map((s, i) => sanitizeService(s, current.services[i] ?? d.services[i], i))
        .filter((s): s is Service => Boolean(s))
    : current.services;

  return {
    name: str(raw.name, 120, current.name) || d.name,
    title: str(raw.title, 120, current.title) || d.title,
    rnpiNumber: str(raw.rnpiNumber, 30, current.rnpiNumber) || d.rnpiNumber,
    location: str(raw.location, 200, current.location) || d.location,
    bio: str(raw.bio, 2000, current.bio),
    tags,
    whatsapp: str(raw.whatsapp, 20, current.whatsapp).replace(/\D/g, "") || d.whatsapp,
    instagram: str(raw.instagram, 60, current.instagram).replace(/^@/, "") || d.instagram,
    tiktok: str(raw.tiktok, 60, current.tiktok).replace(/^@/, "") || d.tiktok,
    linkedin: safeUrl(raw.linkedin ?? current.linkedin, current.linkedin),
    email: str(raw.email, 160, current.email) || d.email,
    bankHolder: str(raw.bankHolder, 120, current.bankHolder) || d.bankHolder,
    bankRut: str(raw.bankRut, 20, current.bankRut) || d.bankRut,
    bankName: str(raw.bankName, 80, current.bankName) || d.bankName,
    bankAccountType: str(raw.bankAccountType, 60, current.bankAccountType) || d.bankAccountType,
    bankAccountNumber: str(raw.bankAccountNumber, 40, current.bankAccountNumber) || d.bankAccountNumber,
    bankEmail: str(raw.bankEmail, 160, current.bankEmail) || d.bankEmail,
    workingDays: workingDays.length > 0 ? workingDays : d.workingDays,
    timeSlots: timeSlots.length > 0 ? timeSlots : d.timeSlots,
    scheduleLabel: str(raw.scheduleLabel, 200, current.scheduleLabel) || d.scheduleLabel,
    services: services.length > 0 ? services : current.services,
    // Server-managed: only changed through the image upload endpoints.
    photoData: current.photoData,
    supersaludQrData: current.supersaludQrData,
  };
}

export async function loadConfig(): Promise<SiteConfig> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, SETTINGS_ID));
  const stored = (row?.data ?? {}) as Partial<SiteConfig>;
  return { ...clone(DEFAULT_SITE_CONFIG), ...stored };
}

export async function saveConfig(config: SiteConfig): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ id: SETTINGS_ID, data: config, updatedAt: new Date() })
    .onConflictDoUpdate({ target: siteSettings.id, set: { data: config, updatedAt: new Date() } });
}
