/**
 * Optional image caption for an ingested photo when a projector file is already on disk.
 * Code-agent screenshots use vision/service.ts instead. General chat does not send images.
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
