// Para probar en tu equipo: copia este archivo como config.js y pon los datos de tu proyecto.
// config.js NO se sube a GitHub (está en .gitignore). En producción lo genera el workflow
// de GitHub Pages desde los Secrets SUPABASE_URL y SUPABASE_ANON_KEY.
// Usa SOLO la anon key. Nunca pongas aquí la service_role key.
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'tu-anon-key';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
