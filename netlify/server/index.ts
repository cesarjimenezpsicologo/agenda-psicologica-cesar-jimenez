import { getStore } from "@netlify/blobs";
import { and, desc, eq, gte } from "drizzle-orm";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { db } from "../../db/index.ts";
import { bookings } from "../../db/schema.ts";
import {
  MIN_PASSWORD_LENGTH,
  changePassword,
  checkPassword,
  createSession,
  currentSessionHash,
  destroySession,
  randomToken,
  sha256,
} from "./auth.ts";
import { loadConfig, sanitizeConfig, saveConfig } from "./config.ts";
import { DEFAULT_PHOTO_URL, DEFAULT_QR_URL, SITE_TIMEZONE } from "./defaults.ts";

export const config = {
  path: "/api/*",
};

const mediaStore = () => getStore({ name: "site-media", consistency: "strong" });
const boletaStore = () => getStore({ name: "boletas", consistency: "strong" });
const recoveryStore = () => getStore({ name: "admin-recovery", consistency: "strong" });

const MEDIA = {
  photo: { field: "photoData", contentType: "image/jpeg", defaultUrl: DEFAULT_PHOTO_URL, maxBytes: 1_500_000 },
  qr: { field: "supersaludQrData", contentType: "image/png", defaultUrl: DEFAULT_QR_URL, maxBytes: 1_500_000 },
} as const;
type MediaKey = keyof typeof MEDIA;

const MAX_BOLETA_BYTES = 750 * 1024;

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.use("/api/*", bodyLimit({ maxSize: 3 * 1024 * 1024, onError: (c) => c.json({ error: "Archivo demasiado grande." }, 413) }));

app.onError((err, c) => {
  console.error("API error:", err);
  return c.json({ error: "Error interno del servidor. Intenta nuevamente." }, 500);
});

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function decodeDataUrl(dataUrl: unknown, allowedTypes: string[]): Uint8Array | null {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m || !allowedTypes.includes(m[1].toLowerCase())) return null;
  return new Uint8Array(Buffer.from(m[2], "base64"));
}

function zonedTimeToUtc(dateISO: string, time: string, timeZone = SITE_TIMEZONE): number {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const offsetAt = (ts: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ts;
  };
  let guess = wallAsUtc - offsetAt(wallAsUtc);
  guess = wallAsUtc - offsetAt(guess);
  return guess;
}

function todayInSiteTz(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIMEZONE }).format(new Date());
}

type BookingRow = typeof bookings.$inferSelect;

function publicBooking(b: BookingRow) {
  return {
    id: b.id,
    date: b.date,
    time: b.time,
    serviceId: b.serviceId,
    serviceTitle: b.serviceTitle,
    duration: b.duration,
    price: b.price,
    modality: "100% Online",
    patientName: b.patientName,
    patientPhone: b.patientPhone,
    paymentStatus: b.paymentStatus,
    hasBoleta: Boolean(b.boletaUploadedAt),
    boletaPdfName: b.boletaName,
    createdAt: b.createdAt.toISOString(),
  };
}

function adminBooking(b: BookingRow) {
  return {
    ...publicBooking(b),
    patientRut: b.patientRut || "No informado",
    patientEmail: b.patientEmail,
    reason: b.reason || "Sin observaciones adicionales",
    transferRef: b.transferRef,
    paidAt: b.paidAt?.toISOString() ?? null,
    boletaUploadedAt: b.boletaUploadedAt?.toISOString() ?? null,
  };
}

async function findBooking(id: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  return row ?? null;
}

function tokenMatches(row: BookingRow, token: unknown): boolean {
  return typeof token === "string" && token.length > 10 && sha256(token) === row.accessTokenHash;
}

type AdminEnv = { Variables: { sessionHash: string } };

async function requireAdmin(c: Context<AdminEnv>, next: Next) {
  const sessionHash = await currentSessionHash(c);
  if (!sessionHash) return c.json({ error: "Sesión de administrador caducada. Ingresa nuevamente." }, 401);
  c.set("sessionHash", sessionHash);
  await next();
}

app.get("/api/config", async (c) => {
  return c.json({ config: await loadConfig() });
});

app.get("/api/media/:key", async (c) => {
  const key = c.req.param("key") as MediaKey;
  if (!(key in MEDIA)) return c.notFound();
  const data = await mediaStore().get(key, { type: "arrayBuffer" });
  if (!data) return c.notFound();
  return c.body(data, 200, {
    "Content-Type": MEDIA[key].contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

app.get("/api/availability", async (c) => {
  const rows = await db
    .select({ date: bookings.date, time: bookings.time })
    .from(bookings)
    .where(gte(bookings.date, todayInSiteTz()));
  return c.json({ occupied: rows });
});

app.post("/api/bookings", async (c) => {
  const body = await readJson(c);
  const cfg = await loadConfig();

  const date = text(body.date, 10);
  const time = text(body.time, 5);
  const patientName = text(body.patientName, 120);
  const patientEmail = text(body.patientEmail, 160);
  const patientPhone = text(body.patientPhone, 40);
  const patientRut = text(body.patientRut, 20);
  const reason = text(body.reason, 2000);

  if (!patientName || !patientPhone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) {
    return c.json({ error: "Completa tu nombre, correo y teléfono correctamente." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !cfg.timeSlots.includes(time)) {
    return c.json({ error: "Fecha u horario no válido." }, 400);
  }
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!cfg.workingDays.includes(weekday)) {
    return c.json({ error: "Ese día no hay atención disponible." }, 400);
  }
  const startsAt = zonedTimeToUtc(date, time);
  if (startsAt - Date.now() < 60 * 60 * 1000) {
    return c.json({ error: "No se permite agendar con menos de 1 hora de anticipación." }, 400);
  }
  if (startsAt - Date.now() > 366 * 24 * 60 * 60 * 1000) {
    return c.json({ error: "Solo se puede agendar con hasta un año de anticipación." }, 400);
  }

  const service = cfg.services.find((s) => s.id === body.serviceId) ?? cfg.services[0];
  const accessToken = randomToken(24);

  for (let attempt = 0; attempt < 8; attempt++) {
    const digits = attempt < 5 ? 4 : 6;
    const id = `CJ-${Math.floor(10 ** (digits - 1) + Math.random() * 9 * 10 ** (digits - 1))}`;
    const [created] = await db
      .insert(bookings)
      .values({
        id,
        accessTokenHash: sha256(accessToken),
        date,
        time,
        serviceId: service.id,
        serviceTitle: service.title,
        duration: service.duration,
        price: service.price,
        patientName,
        patientRut,
        patientEmail,
        patientPhone,
        reason,
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      return c.json({ booking: publicBooking(created), accessToken }, 201);
    }

    const [taken] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.date, date), eq(bookings.time, time)));
    if (taken) {
      return c.json({ error: "Este horario acaba de ocuparse. Por favor elige otro bloque.", code: "slot_taken" }, 409);
    }
  }
  return c.json({ error: "No se pudo generar el código de reserva. Intenta nuevamente." }, 500);
});

app.post("/api/bookings/lookup", async (c) => {
  const body = await readJson(c);
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const result = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = await findBooking(text((item as Record<string, unknown>).id, 20));
    if (row && tokenMatches(row, (item as Record<string, unknown>).token)) result.push(publicBooking(row));
  }
  return c.json({ bookings: result });
});

app.post("/api/bookings/:id/payment", async (c) => {
  const body = await readJson(c);
  const row = await findBooking(c.req.param("id"));
  if (!row) return c.json({ error: "Reserva no encontrada." }, 404);

  const isAdmin = Boolean(await currentSessionHash(c));
  if (!isAdmin && !tokenMatches(row, body.token)) return c.json({ error: "No autorizado." }, 403);

  const status = body.status;
  if (status === "paid") {
    const transferRef = text(body.transferRef, 60);
    if (transferRef.length < 4) return c.json({ error: "Ingresa un comprobante válido." }, 400);
    if (!isAdmin && zonedTimeToUtc(row.date, row.time) - Date.now() < 60 * 60 * 1000) {
      return c.json({ error: "El plazo de pago venció (menos de 1 hora antes de la cita)." }, 400);
    }
    const [updated] = await db
      .update(bookings)
      .set({ paymentStatus: "paid", transferRef, paidAt: new Date() })
      .where(eq(bookings.id, row.id))
      .returning();
    return c.json({ booking: isAdmin ? adminBooking(updated) : publicBooking(updated) });
  }
  if (status === "failed") {
    if (row.paymentStatus === "paid" && !isAdmin) return c.json({ booking: publicBooking(row) });
    const [updated] = await db
      .update(bookings)
      .set({ paymentStatus: "failed" })
      .where(eq(bookings.id, row.id))
      .returning();
    return c.json({ booking: isAdmin ? adminBooking(updated) : publicBooking(updated) });
  }
  return c.json({ error: "Estado de pago no válido." }, 400);
});

app.post("/api/bookings/:id/boleta", async (c) => {
  const body = await readJson(c);
  const row = await findBooking(c.req.param("id"));
  if (!row) return c.json({ error: "Reserva no encontrada." }, 404);
  const isAdmin = Boolean(await currentSessionHash(c));
  if (!isAdmin && !tokenMatches(row, body.token)) return c.json({ error: "No autorizado." }, 403);

  const pdf = await boletaStore().get(row.id, { type: "arrayBuffer" });
  if (!pdf) return c.json({ error: "Aún no se ha adjuntado la boleta para esta reserva." }, 404);
  return c.body(pdf, 200, { "Content-Type": "application/pdf" });
});

app.post("/api/admin/login", async (c) => {
  const body = await readJson(c);
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  if (!password) return c.json({ error: "Ingresa tu clave." }, 400);

  const result = await checkPassword(password);
  if (!result.ok) {
    if (result.locked) {
      const minutes = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 600) / 60));
      return c.json({ error: `Demasiados intentos fallidos. Intenta nuevamente en ${minutes} minuto(s).` }, 429);
    }
    return c.json({ error: "Clave de administrador incorrecta." }, 401);
  }
  await createSession(c);
  return c.json({ ok: true });
});

app.post("/api/admin/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get("/api/admin/session", async (c) => {
  return c.json({ authenticated: Boolean(await currentSessionHash(c)) });
});

app.post("/api/admin/recovery/send", async (c) => {
  const cfg = await loadConfig();
  const targetEmail = (process.env.ADMIN_RECOVERY_EMAIL || cfg.email || "cesar.jimenez.psicologo@hotmail.com").trim();
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    return c.json(
      { error: "Falta configurar RESEND_API_KEY en Netlify (Site configuration -> Environment variables) para enviar correos." },
      500,
    );
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await recoveryStore().setJSON("active-code", {
    codeHash: sha256(code),
    expiresAt: Date.now() + 15 * 60 * 1000,
    attempts: 0,
  });

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "Agenda Ps. César Jiménez <onboarding@resend.dev>",
      to: [targetEmail],
      subject: `Código de recuperación de cuenta: ${code}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px;">
          <h2 style="color: #0f172a; margin-top: 0;">Recuperación de Acceso Administrador</h2>
          <p style="color: #475569; font-size: 14px;">Hola César, usa el siguiente código de 6 dígitos para crear una nueva contraseña e ingresar nuevamente a tu página:</p>
          <div style="background: #f4f7f5; border: 1px solid #c6d7cd; border-radius: 12px; padding: 16px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #25362d; margin: 20px 0;">
            ${code}
          </div>
          <p style="color: #64748b; font-size: 12px;">Este código expira en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.</p>
        </div>
      `,
    }),
  });

  if (!emailRes.ok) {
    const errDetail = await emailRes.text().catch(() => "");
    console.error("Resend error:", errDetail);
    return c.json({ error: "No se pudo enviar el correo. Verifica tu RESEND_API_KEY y correo autorizado." }, 502);
  }

  return c.json({ ok: true, message: `Código enviado a ${targetEmail}. Revisa tu bandeja de entrada o spam.` });
});

app.post("/api/admin/recovery/reset", async (c) => {
  const body = await readJson(c);
  const code = text(body.code, 10);
  const newPassword = typeof body.newPassword === "string" ? body.newPassword.trim().slice(0, 200) : "";

  if (!code || code.length < 6) {
    return c.json({ error: "Ingresa el código de 6 dígitos recibido en tu correo." }, 400);
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400);
  }

  const record = (await recoveryStore().get("active-code", { type: "json" })) as {
    codeHash: string;
    expiresAt: number;
    attempts: number;
  } | null;

  if (!record || Date.now() > record.expiresAt) {
    return c.json({ error: "El código expiró o no existe. Solicita uno nuevo." }, 400);
  }

  if (record.attempts >= 5) {
    await recoveryStore().delete("active-code");
    return c.json({ error: "Demasiados intentos con este código. Solicita uno nuevo." }, 429);
  }

  if (sha256(code) !== record.codeHash) {
    await recoveryStore().setJSON("active-code", { ...record, attempts: record.attempts + 1 });
    return c.json({ error: "Código de verificación incorrecto." }, 400);
  }

  await recoveryStore().delete("active-code");
  await changePassword(newPassword, null);
  await createSession(c);
  return c.json({ ok: true });
});

const admin = new Hono<AdminEnv>();
admin.use("*", requireAdmin);

admin.put("/config", async (c) => {
  const body = await readJson(c);
  const current = await loadConfig();
  const next = sanitizeConfig(body.config, current);
  await saveConfig(next);
  return c.json({ config: next });
});

admin.post("/password", async (c) => {
  const body = await readJson(c);
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword.slice(0, 200) : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword.slice(0, 200) : "";
  if (newPassword.trim().length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `La nueva clave debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, 400);
  }
  const check = await checkPassword(currentPassword);
  if (!check.ok) {
    return c.json(
      { error: check.locked ? "Demasiados intentos fallidos. Intenta más tarde." : "La clave actual no es correcta." },
      check.locked ? 429 : 400,
    );
  }
  await changePassword(newPassword.trim(), c.get("sessionHash"));
  return c.json({ ok: true });
});

admin.post("/media/:key", async (c) => {
  const key = c.req.param("key") as MediaKey;
  if (!(key in MEDIA)) return c.notFound();
  const body = await readJson(c);
  const bytes = decodeDataUrl(body.dataUrl, [MEDIA[key].contentType]);
  if (!bytes || bytes.byteLength === 0) return c.json({ error: "Imagen no válida." }, 400);
  if (bytes.byteLength > MEDIA[key].maxBytes) return c.json({ error: "La imagen es demasiado pesada." }, 413);

  await mediaStore().set(key, bytes.buffer as ArrayBuffer);
  const cfg = await loadConfig();
  cfg[MEDIA[key].field] = `/api/media/${key}?v=${Date.now()}`;
  await saveConfig(cfg);
  return c.json({ config: cfg });
});

admin.delete("/media/:key", async (c) => {
  const key = c.req.param("key") as MediaKey;
  if (!(key in MEDIA)) return c.notFound();
  await mediaStore().delete(key);
  const cfg = await loadConfig();
  cfg[MEDIA[key].field] = MEDIA[key].defaultUrl;
  await saveConfig(cfg);
  return c.json({ config: cfg });
});

admin.get("/bookings", async (c) => {
  const rows = await db.select().from(bookings).orderBy(desc(bookings.createdAt));
  return c.json({ bookings: rows.map(adminBooking) });
});

admin.delete("/bookings/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(bookings).where(eq(bookings.id, id));
  await boletaStore().delete(id);
  return c.json({ ok: true });
});

admin.post("/bookings/:id/boleta", async (c) => {
  const row = await findBooking(c.req.param("id"));
  if (!row) return c.json({ error: "Reserva no encontrada." }, 404);
  const body = await readJson(c);
  const bytes = decodeDataUrl(body.dataUrl, ["application/pdf"]);
  if (!bytes || bytes.byteLength === 0) return c.json({ error: "El archivo debe ser un PDF válido." }, 400);
  if (bytes.byteLength > MAX_BOLETA_BYTES) return c.json({ error: "El archivo PDF es muy pesado (máximo 750 KB)." }, 413);

  await boletaStore().set(row.id, bytes.buffer as ArrayBuffer);
  const fileName = text(body.fileName, 120).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, "_") || `Boleta_SII_${row.id}.pdf`;
  const [updated] = await db
    .update(bookings)
    .set({ boletaName: fileName, boletaUploadedAt: new Date() })
    .where(eq(bookings.id, row.id))
    .returning();
  return c.json({ booking: adminBooking(updated) });
});

app.route("/api/admin", admin);

app.all("/api/*", (c) => c.json({ error: "Ruta no encontrada." }, 404));

export default app;
