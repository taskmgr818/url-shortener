import assert from 'node:assert/strict'
import { test } from 'node:test'
import app from '../src/index.tsx'
import { isAllowedUrl } from '../src/allowed-url.ts'

const createStore = (entries = []) => {
  const data = new Map(entries)
  const writes = []
  return {
    data,
    writes,
    KV: {
      get: async (key) => data.get(key) ?? null,
      put: async (key, value) => {
        writes.push([key, value])
        data.set(key, value)
      }
    }
  }
}

const createLink = (store, values) => app.request('http://localhost/create', {
  method: 'POST',
  headers: { origin: 'http://localhost' },
  body: new URLSearchParams(values)
}, { KV: store.KV })

test('白名单接受指定飞书域名、bitnp.net 及各级子域名', () => {
  for (const url of [
    'https://c13sv18hodb.feishu.cn/wiki/example',
    'http://bitnp.net/path?query=yes#part',
    'https://www.bitnp.net/',
    'https://a.b.bitnp.net:8443/path',
    'https://C13SV18HODB.FEISHU.CN/path',
    'https://WWW.BITNP.NET/path',
    'https://bitnp.net./path'
  ]) {
    assert.equal(isAllowedUrl(url), true, url)
  }
})

test('白名单拒绝相似域名、其他飞书域名、非 HTTP 协议和无效网址', async () => {
  const store = createStore()
  for (const url of [
    'https://example.com/',
    'https://fakebitnp.net/',
    'https://bitnp.net.evil.example/',
    'https://c13sv18hodb.feishu.cn.evil.example/',
    'https://other.feishu.cn/',
    'https://sub.c13sv18hodb.feishu.cn/',
    'https://bitnp.net@evil.example/',
    'https://evil.example/?url=https://bitnp.net/',
    'ftp://bitnp.net/file',
    'javascript:alert(1)',
    'data:text/html,https://bitnp.net/',
    '//bitnp.net/path',
    'not a url',
    ''
  ]) {
    assert.equal(isAllowedUrl(url), false, url)
    const response = await createLink(store, { url, customKey: 'denied' })
    assert.equal(response.status, 400, url)
    assert.match(await response.text(), /请检查/)
  }
  assert.deepEqual(store.writes, [])
})

test('允许的网址可创建自定义短链，并按原网址跳转', async () => {
  const store = createStore()
  const target = 'https://c13sv18hodb.feishu.cn/wiki/example?from=short#section'
  const response = await createLink(store, { url: `  ${target}  `, customKey: ' My-link_1 ' })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /短链接已生成/)
  assert.match(html, /http:\/\/localhost\/My-link_1/)
  assert.deepEqual(store.writes, [['My-link_1', target]])

  const redirect = await app.request('http://localhost/My-link_1', {}, { KV: store.KV })
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get('location'), target)
})

test('自动分配短码时，同一网址复用已生成的短链', async () => {
  for (const values of [
    { url: 'https://bitnp.net/' },
    { url: 'https://a.bitnp.net/', customKey: '' }
  ]) {
    const store = createStore()
    const response = await createLink(store, values)
    assert.equal(response.status, 200)
    assert.equal(store.writes.length, 2)
    const [[key, target], [indexKey, indexedKey]] = store.writes
    assert.match(key, /^[a-f0-9]{6}$/)
    assert.equal(target, values.url)
    assert.match(indexKey, /^url:[a-f0-9]{64}$/)
    assert.equal(indexedKey, key)

    const duplicate = await createLink(store, { url: `  ${values.url}  ` })
    assert.equal(duplicate.status, 200)
    assert.equal(await duplicate.text(), await response.text())
    assert.equal(store.writes.length, 2)
  }
})

test('反向索引指向已删除的短码时，重新生成短链', async () => {
  const store = createStore()
  const url = 'https://bitnp.net/path'
  await createLink(store, { url })
  const [[key], [indexKey]] = store.writes
  store.data.delete(key)

  const response = await createLink(store, { url })
  assert.equal(response.status, 200)
  assert.equal(store.writes.length, 4)
  assert.equal(store.writes[3][0], indexKey)
  assert.equal(store.data.get(store.data.get(indexKey)), url)
})

test('反向索引写入失败时，仍返回可跳转的短链', async (t) => {
  const store = createStore()
  const put = store.KV.put
  store.KV.put = async (key, value) => {
    if (key.startsWith('url:')) {
      throw new Error('KV write failed')
    }
    await put(key, value)
  }
  const warn = t.mock.method(console, 'warn', () => {})

  const target = 'https://bitnp.net/path'
  const response = await createLink(store, { url: target })
  assert.equal(response.status, 200)
  assert.equal(warn.mock.callCount(), 1)
  const [[key]] = store.writes
  assert.match(await response.text(), new RegExp(`http://localhost/${key}`))

  const redirect = await app.request(`http://localhost/${key}`, {}, { KV: store.KV })
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get('location'), target)
})

test('重复短码保留原数据，显示中文提示并保留表单输入', async () => {
  const store = createStore([['my-link', 'https://bitnp.net/old']])
  const response = await createLink(store, { url: 'https://bitnp.net/new', customKey: 'my-link' })
  assert.equal(response.status, 409)
  const html = await response.text()
  assert.match(html, /这个短码已被使用/)
  assert.match(html, /value="https:\/\/bitnp.net\/new"/)
  assert.match(html, /value="my-link"/)
  assert.equal(store.data.get('my-link'), 'https://bitnp.net/old')
  assert.deepEqual(store.writes, [])
})

test('无效及保留短码仍会被拒绝', async () => {
  const store = createStore()
  for (const customKey of ['create', 'static', 'a/b', '中文', 'a'.repeat(65)]) {
    const response = await createLink(store, { url: 'https://bitnp.net/', customKey })
    assert.equal(response.status, 400, customKey)
  }
  assert.deepEqual(store.writes, [])
})

test('原有白名单外的短链继续跳转', async () => {
  const store = createStore([['legacy', 'https://example.com/existing']])
  const response = await app.request('http://localhost/legacy', {}, { KV: store.KV })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://example.com/existing')
})

test('中文页面引用本地样式，错误内容经过 HTML 转义', async () => {
  const home = await app.request('http://localhost/')
  const html = await home.text()
  assert.match(html, /lang="zh-CN"/)
  assert.match(html, /name="viewport"/)
  assert.match(html, /href="\/static\/style.css"/)
  assert.match(html, /生成短链接/)
  assert.doesNotMatch(html, /fonts\.xz\.style|cdn\.jsdelivr\.net/)

  const response = await createLink(createStore(), { url: '"><script>alert(1)</script>' })
  const errorHtml = await response.text()
  assert.equal(response.status, 400)
  assert.doesNotMatch(errorHtml, /<script>alert\(1\)<\/script>/)
  assert.match(errorHtml, /&lt;script&gt;/)
})

test('跨站表单仍受到 CSRF 保护', async () => {
  const store = createStore()
  const response = await app.request('http://localhost/create', {
    method: 'POST',
    headers: { origin: 'https://other.example' },
    body: new URLSearchParams({ url: 'https://bitnp.net/' })
  }, { KV: store.KV })
  assert.equal(response.status, 403)
  assert.deepEqual(store.writes, [])
})
