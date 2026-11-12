const copyButton = document.getElementById('copy-short-url')
const shortUrl = document.getElementById('short-url')
const copyStatus = document.getElementById('copy-status')

if (copyButton && shortUrl && copyStatus) {
  copyButton.addEventListener('click', async () => {
    copyButton.disabled = true
    copyStatus.textContent = ''
    let copied = false

    try {
      await navigator.clipboard.writeText(shortUrl.value)
      copied = true
    } catch {
      shortUrl.focus()
      shortUrl.select()
      try {
        copied = document.execCommand('copy')
      } catch {
        copied = false
      }
    }

    copyStatus.textContent = copied ? '已复制' : '复制失败，请手动复制已选中的链接。'
    copyButton.disabled = false
  })
}
