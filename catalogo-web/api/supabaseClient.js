import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG_SUPABASE } from './config.js'; 

export const supabase = createClient(CONFIG_SUPABASE.URL, CONFIG_SUPABASE.KEY);