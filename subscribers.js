// Subscriber + recipient store (Supabase).
//
// This owns WHO the email goes to — independent of WHAT it says (that's content.js):
//   personal mode → getRecipient()/setRecipient()  (one address, settings table)
//   domain   mode → getActiveSubscribers()          (everyone who signed up, minus opt-outs)
//
// The public /signup form calls addSignup(); the /unsubscribe page calls
// unsubscribeByToken(). Run schema.sql once to create the `signups` + `settings` tables.

import { createClient } from '@supabase/supabase-js';

// Sample rows for seeding a test list from the /admin console.
export const SAMPLE_SUBSCRIBERS = [
  { name: 'Emily Johnson', email: 'emily.johnson@example.com', company: 'Acme Corp' },
  { name: 'Michael Smith', email: 'michael.smith@example.com', company: 'FinFlow' },
  { name: 'Olivia Brown', email: 'olivia.brown@example.com', company: 'GrowthLab' },
  { name: 'James Williams', email: 'james.williams@example.com', company: 'Stackr' },
  { name: 'Sophia Davis', email: 'sophia.davis@example.com', company: 'Clarity HQ' },
  { name: 'Liam Miller', email: 'liam.miller@example.com', company: 'BuildCo' },
];

/**
 * Insert one signup into the `signups` table. `created_at` and `token` are filled
 * by DB defaults. Used by the public signup form (app.js).
 * @param {{ name: string, email: string, company?: string }} signup
 * @returns {Promise<object>} the inserted row (incl. id + token)
 */
export async function addSignup({ name, email, company }) {
  const clean = (s) => (typeof s === 'string' ? s.trim() : '');
  const row = {
    name: clean(name),
    email: clean(email),
    company: clean(company) || null, // optional
  };
  if (!row.name || !row.email) {
    throw new Error('Signup requires both a name and an email.');
  }

  const supabase = supabaseClient();
  const { data, error } = await supabase.from('signups').insert(row).select().single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

/**
 * All signups as FULL rows (most recent first) for the manager UI.
 * @returns {Promise<Array<{id:number,name:string,email:string,company:string,created_at:string,unsubscribed_at:string|null}>>}
 */
export async function listSubscribers() {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('signups')
    .select('id, name, email, company, created_at, unsubscribed_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase list failed: ${error.message}`);
  return data || [];
}

/** Delete one signup by id. */
export async function deleteSubscriber(id) {
  const supabase = supabaseClient();
  const { error } = await supabase.from('signups').delete().eq('id', Number(id));
  if (error) throw new Error(`Supabase delete failed: ${error.message}`);
}

/** Delete ALL signups. Returns how many rows were removed. */
export async function clearSubscribers() {
  const supabase = supabaseClient();
  // Supabase requires a filter on delete; identity ids start at 1, so gte(0) = all.
  const { data, error } = await supabase.from('signups').delete().gte('id', 0).select('id');
  if (error) throw new Error(`Supabase clear failed: ${error.message}`);
  return data?.length ?? 0;
}

/** Seed SAMPLE_SUBSCRIBERS for testing. Additive. Returns rows inserted. */
export async function seedSubscribers() {
  const supabase = supabaseClient();
  const { data, error } = await supabase.from('signups').insert(SAMPLE_SUBSCRIBERS).select('id');
  if (error) throw new Error(`Supabase seed failed: ${error.message}`);
  return data?.length ?? SAMPLE_SUBSCRIBERS.length;
}

// ---------------------------------------------------------------------------
// Recipient (personal mode) — a single row in the `settings` key/value table.
// ---------------------------------------------------------------------------
const RECIPIENT_KEY = 'briefing_recipient';

/**
 * The personal-mode recipient: the stored `settings.briefing_recipient`, falling
 * back to RESEND_TO / GMAIL_USER. Resilient — if Supabase isn't configured/reachable,
 * just use the env var so personal sends still work without a database.
 * @returns {Promise<string>} an email address (may be '' if nothing is set)
 */
export async function getRecipient() {
  const fallback = (process.env.RESEND_TO || process.env.GMAIL_USER || '').trim();
  if (!isSupabaseConfigured()) return fallback;
  try {
    const supabase = supabaseClient();
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', RECIPIENT_KEY)
      .maybeSingle();
    if (error) return fallback;
    return (data?.value || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Save/update the personal-mode recipient in the `settings` table. */
export async function setRecipient(email) {
  const value = (email || '').trim();
  if (!value) throw new Error('Recipient email is required.');
  const supabase = supabaseClient();
  const { error } = await supabase
    .from('settings')
    .upsert({ key: RECIPIENT_KEY, value }, { onConflict: 'key' });
  if (error) throw new Error(`Could not save recipient: ${error.message}`);
  return value;
}

// ---------------------------------------------------------------------------
// Subscribers (domain mode) + unsubscribe.
// ---------------------------------------------------------------------------

/**
 * Every active (non-unsubscribed) subscriber — the domain-mode fan-out list.
 * @returns {Promise<Array<{id:number,name:string,email:string,token:string}>>}
 */
export async function getActiveSubscribers() {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('signups')
    .select('id, name, email, token')
    .is('unsubscribed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase subscriber query failed: ${error.message}`);
  return data || [];
}

/** Look up a signup by its unsubscribe token (for the confirmation page). */
export async function getSignupByToken(token) {
  if (!token) return null;
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('signups')
    .select('id, name, email, unsubscribed_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new Error(`Supabase token lookup failed: ${error.message}`);
  return data;
}

/**
 * Mark the signup with this token as unsubscribed (idempotent).
 * @returns {Promise<{email:string}|null>} the affected row, or null if no match.
 */
export async function unsubscribeByToken(token) {
  if (!token) return null;
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('signups')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('token', token)
    .select('email')
    .maybeSingle();
  if (error) throw new Error(`Supabase unsubscribe failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** True if both Supabase env vars are present. */
export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

/** Build a Supabase client from env vars (server-side use only). */
function supabaseClient() {
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing Supabase config. Set SUPABASE_URL and SUPABASE_KEY in .env.');
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}
