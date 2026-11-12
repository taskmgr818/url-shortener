import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { renderer } from './renderer'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { isAllowedUrl } from './allowed-url'

type Bindings = {
  KV: KVNamespace
}

const app = new Hono<{
  Bindings: Bindings
}>()

app.all('*', renderer)

const reservedKeys = new Set(['create', 'static'])

app.get('/:key{[A-Za-z0-9_-]{1,64}}', async (c) => {
  const key = c.req.param('key')
  const url = await c.env.KV.get(key)

  if (url === null) {
    return c.redirect('/')
  }

  return c.redirect(url)
})

const CreateForm = ({ url = '', customKey = '', errors = [] }: {
  url?: string
  customKey?: string
  errors?: string[]
}) => (
    <section class="panel" aria-labelledby="form-title">
      <h2 id="form-title">创建短链接</h2>
      {errors.length > 0 && (
        <div class="notice error" role="alert">
          <ul>{errors.map((message) => <li>{message}</li>)}</ul>
        </div>
      )}
      <form action="/create" method="post">
        <label for="url">原始网址</label>
        <input
          id="url"
          type="url"
          name="url"
          required
          autocomplete="off"
          value={url}
          placeholder="https://"
        />
        <label for="customKey">自定义短码 <span class="optional">（选填）</span></label>
        <input
          id="customKey"
          type="text"
          name="customKey"
          autocomplete="off"
          maxlength={64}
          pattern="[A-Za-z0-9_\-]{1,64}"
          value={customKey}
          placeholder="留空则随机生成"
        />
        <button type="submit">生成短链接</button>
      </form>
    </section>
)

app.get('/', (c) => c.render(<CreateForm />))

const schema = z.object({
  url: z.string({ required_error: '请输入原始网址。', invalid_type_error: '请输入有效的网址。' })
    .trim()
    .url('请输入完整、有效的网址。')
    .refine(isAllowedUrl, '仅支持 c13sv18hodb.feishu.cn、bitnp.net 及其子域名的 HTTP / HTTPS 网址。'),
  customKey: z.string().trim()
    .max(64, '自定义短码最多 64 个字符。')
    .refine(
      (key) => key === '' || /^[A-Za-z0-9_-]+$/.test(key),
      '自定义短码只能包含英文字母、数字、连字符（-）和下划线（_）。'
    )
    .refine(
      (key) => !reservedKeys.has(key),
      '此短码为保留短码，请换一个。'
    )
    .optional()
})

const validator = zValidator('form', schema, (result, c) => {
  if (!result.success) {
    c.status(400)
    return c.render(
      <CreateForm
        url={typeof result.data.url === 'string' ? result.data.url : ''}
        customKey={typeof result.data.customKey === 'string' ? result.data.customKey : ''}
        errors={result.error.issues.map((issue) => issue.message)}
      />,
      { title: '请检查输入 · 短链接' }
    )
  }
})

const createKey = async (kv: KVNamespace, url: string): Promise<string> => {
  const uuid = crypto.randomUUID()
  const key = uuid.substring(0, 6)
  const result = await kv.get(key)
  if (result === null) {
    await kv.put(key, url)
  } else {
    return await createKey(kv, url)
  }
  return key
}

app.post('/create', csrf(), validator, async (c) => {
  const { url, customKey } = c.req.valid('form')
  let key: string

  if (customKey) {
    const existingUrl = await c.env.KV.get(customKey)
    if (existingUrl !== null) {
      c.status(409)
      return c.render(
        <CreateForm url={url} customKey={customKey} errors={['这个短码已被使用，请换一个。']} />,
        { title: '短码已被使用 · 短链接' }
      )
    }
    await c.env.KV.put(customKey, url)
    key = customKey
  } else {
    key = await createKey(c.env.KV, url)
  }

  const shortenUrl = new URL(`/${key}`, c.req.url)

  return c.render(
    <section class="panel" aria-labelledby="result-title">
      <h2 id="result-title">短链接已生成</h2>
      <input
        id="short-url"
        class="result-url"
        aria-label="短链接"
        type="text"
        value={shortenUrl.toString()}
        readonly
        autofocus
      />
      <p class="destination"><a href={url}>查看原始网址</a></p>
      <div class="actions">
        <button
          type="button"
          onclick="navigator.clipboard.writeText(document.getElementById('short-url').value).then(() => this.textContent = '已复制', () => this.textContent = '复制失败，请重试')"
        >复制短链接</button>
        <a href="/">继续创建</a>
      </div>
    </section>,
    { title: '创建成功 · 短链接' }
  )
})

export default app
