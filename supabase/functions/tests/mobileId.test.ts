import { deriveKeyAHex } from '../_shared/mobileId.ts'

Deno.test('Mobile ID diversification matches developer guide vector', async () => {
  const keyA = await deriveKeyAHex(
    '8619C154D893C733D2888CE3937AF017',
    '081122334455667788',
  )
  if (keyA !== 'B0A42687AA50A67A6DCEB68EA59A1332') {
    throw new Error(`Unexpected KEYA: ${keyA}`)
  }
})
