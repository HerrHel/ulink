/** send-feedback 的零依赖 SMTP 客户端（465 隐式 TLS）。
 * 会话六步：EHLO -> AUTH -> MAIL FROM -> RCPT TO -> DATA -> QUIT。
 * Deno.TlsConn.read -> Node socket 'data' 事件 + 行缓冲队列。 */

class SmtpError extends Error {}

class LineReader {
  constructor(socket) {
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.ended = false
    this.err = null
    this.pending = []
    socket.on('data', (c) => {
      this.buf = Buffer.concat([this.buf, c])
      this._pump()
    })
    const done = () => {
      this.ended = true
      this._pump()
    }
    socket.on('end', done)
    socket.on('close', done)
    socket.on('error', (e) => {
      this.err = e
      this._pump()
    })
  }

  _pump() {
    while (this.pending.length) {
      const i = this.buf.indexOf('\r\n')
      if (i >= 0) {
        const s = this.buf.subarray(0, i).toString('utf8')
        this.buf = this.buf.subarray(i + 2)
        this.pending.shift().resolve(s)
        continue
      }
      if (this.err) {
        this.pending.shift().reject(this.err)
        continue
      }
      if (this.ended) {
        if (this.buf.length) {
          const s = this.buf.toString('utf8')
          this.buf = Buffer.alloc(0)
          this.pending.shift().resolve(s)
          continue
        }
        this.pending.shift().reject(new SmtpError('SMTP connection closed'))
        continue
      }
      break
    }
  }

  line() {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this._pump()
    })
  }
}

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64')
}

function wrapBase64(s) {
  return (s.match(/.{1,76}/g) || []).join('\r\n')
}

const crypto = require('crypto')

/** 组装邮件报文：UTF-8 主题 RFC 2047 编码，正文 base64 传输编码 */
function buildMime(subject, body, from, to, replyTo, messageIdDomain) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${messageIdDomain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  if (replyTo) headers.push(`Reply-To: ${replyTo}`)
  return headers.join('\r\n') + '\r\n\r\n' + wrapBase64(b64(body)) + '\r\n'
}

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new SmtpError(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

class SmtpSession {
  constructor(opts) {
    this.host = opts.host
    this.port = opts.port
    this.user = opts.user
    this.pass = opts.pass
    this.socket = null
    this.reader = null
  }

  async connect() {
    const tls = require('tls')
    this.socket = tls.connect({ host: this.host, port: this.port, servername: this.host })
    await new Promise((resolve, reject) => {
      this.socket.once('secureConnect', resolve)
      this.socket.once('error', reject)
    })
    this.reader = new LineReader(this.socket)
    await this.readReply()
    await this.cmd('EHLO ulink.ren', [250])
    await this.auth()
  }

  async readReply() {
    const lines = []
    let line = await this.reader.line()
    lines.push(line)
    while (/^\d{3}-/.test(line)) {
      line = await this.reader.line()
      lines.push(line)
    }
    return { code: Number(line.slice(0, 3)), text: lines.join(' ') }
  }

  send(raw) {
    this.socket.write(raw)
  }

  async cmd(raw, ok) {
    this.send(raw + '\r\n')
    const r = await this.readReply()
    if (!ok.includes(r.code)) throw new SmtpError(raw.slice(0, 30) + ' -> ' + r.code + ' ' + r.text)
    return r.text
  }

  /** 先试 AUTH PLAIN，不被接受则回退 AUTH LOGIN */
  async auth() {
    this.send('AUTH PLAIN ' + b64('\x00' + this.user + '\x00' + this.pass) + '\r\n')
    const r = await this.readReply()
    if (r.code === 235) return
    await this.cmd('AUTH LOGIN', [334])
    await this.cmd(b64(this.user), [334])
    await this.cmd(b64(this.pass), [235])
  }

  async sendMail(from, to, mime) {
    await this.cmd('MAIL FROM:<' + from + '>', [250])
    await this.cmd('RCPT TO:<' + to + '>', [250, 251])
    await this.cmd('DATA', [354])
    // 行首点转义：SMTP 以「行首一个点」结束正文
    this.send(mime.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n')
    const done = await this.readReply()
    if (done.code !== 250) throw new SmtpError('DATA -> ' + done.code + ' ' + done.text)
  }

  async quit() {
    try {
      await this.cmd('QUIT', [221])
    } catch (e) {
      /* 退出失败不影响投递结果 */
    }
  }

  close() {
    try {
      if (this.socket) this.socket.destroy()
    } catch (e) {
      /* 已关闭 */
    }
  }
}

module.exports = { SmtpError, SmtpSession, buildMime, withTimeout, b64 }
