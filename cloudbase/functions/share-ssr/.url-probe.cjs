const fs = require('fs')
const env = {}
for (const line of fs.readFileSync('../../../.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}
const cloudbase = require('@cloudbase/js-sdk')
const app = cloudbase.init({ env: env.VITE_CLOUDBASE_ENV_ID })
const st = app.storage.from('group-images')
;(async () => {
  const r = await st.getPublicUrl('uid/gid/abc.png')
  console.log('getPublicUrl result:', JSON.stringify(r))
})().catch(e => console.log('THREW:', e.message))
