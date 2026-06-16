// Vercel serverless entry for the web console.
// vercel.json rewrites all non-/api paths here; the shared handler routes them.
import { handler } from '../app.js';

export default handler;
