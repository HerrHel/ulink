import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://yqouglfopbmujkqmjgpu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxb3VnbGZvcGJtdWprcW1qZ3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjI2NjAsImV4cCI6MjA5NTUzODY2MH0.jiS802kT9rZZibDC8N3hB1cyvSxHV5xHs9pNjE7Wmnw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('error_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching logs:', error);
    return;
  }
  
  const summary = {};
  for (const log of data) {
    const key = log.error_type + ':' + log.error_message;
    summary[key] = (summary[key] || 0) + 1;
  }
  
  console.log('--- ERROR LOGS SUMMARY ---');
  for (const [key, count] of Object.entries(summary)) {
    console.log(`[${count}] ${key}`);
  }
  console.log('\n--- RECENT LOGS ---');
  console.log(JSON.stringify(data.slice(0, 5), null, 2));
}

main();
