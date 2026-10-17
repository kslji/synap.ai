import { product } from '@surf/shared'

export const MODEL_MISSING_COPY = 'Get your model from synap.surf to start chatting'
export const MODEL_ANOTHER_COPY = 'Get another model on synap.surf'

/** Landing page section that downloads the model file. */
export function modelSiteUrl(): string {
  return `${product.site}/#download`
}
