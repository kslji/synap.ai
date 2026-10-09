/**
 * Stretch: describe a photo with Qwen3.5's mmproj through llama-server.
 *
 * The projector is a separate GGUF (about 670 MB for the 2B model) listed on the
 * chat entry in models.registry.json. It is not downloaded with the chat weights:
 * OCR already indexes images, and loading the projector costs a lot of RAM.
 *
 * TODO: a Models row that downloads mmproj and a "Describe image" button that calls
 * captionImage. Until that file is on disk, ingest uses tesseract.js only.
 */
import { existsSync } from 'node:fs'
import type { LlamaClient } from './llama-client.js'

export function mmprojReady(filePath: string | null | undefined): boolean {
  return Boolean(filePath && existsSync(filePath))
}

export async function captionImage(client: LlamaClient, pngOrJpeg: Buffer, mime: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string> {
  const url = `data:${mime};base64,${pngOrJpeg.toString('base64')}`
  const res = await client.chat([{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url } },
      { type: 'text', text: 'Describe this image in two sentences. Quote any words you can see.' },
    ],
  }], undefined, undefined, 160)
  return String(res.choices[0]?.message?.content ?? '').trim()
}
