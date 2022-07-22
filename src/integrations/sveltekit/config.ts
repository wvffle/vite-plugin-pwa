import type { ResolvedConfig } from 'vite'
import type { ManifestTransform } from 'workbox-build'
import type { BasePartial, GlobPartial, RequiredGlobDirectoryPartial } from 'workbox-build/src/types'
import type { SvelteKitVitePluginOptions, VitePWAOptions } from '../../types'

type WorkboxConfig = Partial<BasePartial & GlobPartial & RequiredGlobDirectoryPartial>

export function configureSvelteKitOptions(viteOptions: ResolvedConfig, options: Partial<VitePWAOptions>) {
  const {
    base = viteOptions.build.base ?? '/',
    adapterFallback,
  } = options.svelteKitVitePluginOptions ?? {}

  // exclude pwa plugin from SSR build
  if (typeof options.includeManifest === 'undefined')
    options.includeManifest = 'client-build'

  // Vite will copy public folder to the globDirectory after pwa plugin runs:
  // globDirectory is the build folder.
  // SvelteKit will copy to the globDirectory before pwa plugin runs (via Vite client build in writeBundle hook):
  // globDirectory is the kit client output folder.
  // We need to disable includeManifestIcons: any icon in the static folder will be twice in the sw's precache manifest.
  if (typeof options.includeManifestIcons === 'undefined')
    options.includeManifestIcons = false

  let config: WorkboxConfig

  if (options.strategies === 'injectManifest') {
    options.injectManifest = options.injectManifest ?? {}
    config = options.injectManifest
  }
  else {
    options.workbox = options.workbox ?? {}
    if (!options.workbox.navigateFallback)
      options.workbox.navigateFallback = adapterFallback ?? base

    config = options.workbox
  }

  // SvelteKit outDir is `.svelte-kit/output/client`.
  // We need to include the parent folder since SvelteKit will generate SSG in `.svelte-kit/output/prerendered` folder.
  if (!config.globDirectory)
    config.globDirectory = '.svelte-kit/output'

  if (!config.modifyURLPrefix)
    config.globPatterns = buildGlobPatterns(config.globPatterns)

  // Vite generates <name>.<hash>.<ext> layout while SvelteKit generates <name>-<hash>.<ext> (Rollup default)
  // Vite and SvelteKit are not aligned: pwa plugin will use /\.[a-f0-9]{8}\./ by default: #164 optimize workbox work
  if (!config.dontCacheBustURLsMatching)
    config.dontCacheBustURLsMatching = /-[a-f0-9]{8}\./

  if (!config.manifestTransforms)
    config.manifestTransforms = [createManifestTransform(base, options.svelteKitVitePluginOptions)]
}

function createManifestTransform(base: string, options?: SvelteKitVitePluginOptions): ManifestTransform {
  return async (entries) => {
    const suffix = options?.trailingSlash === 'always' ? '/' : ''
    let adapterFallback = options?.adapterFallback
    let excludeFallback = false
    // the fallback will be always generate by SvelteKit.
    // The adapter will copy the fallback only if it is provided in its options: we need to exclude it
    if (!adapterFallback) {
      adapterFallback = 'prerendered/fallback.html'
      excludeFallback = true
    }

    const manifest = entries.filter(({ url }) => !(excludeFallback && url === adapterFallback)).map((e) => {
      let url = e.url
      // client assets in `.svelte-kit/output/client` folder.
      // SSG pages in `.svelte-kit/output/prerendered/pages` folder.
      // fallback page in `.svelte-kit/output/prerendered` folder (fallback.html is the default).
      if (url.startsWith('client/'))
        url = url.slice(7)
      else if (url.startsWith('prerendered/pages/'))
        url = url.slice(18)
      else if (url.startsWith('prerendered/'))
        url = url.slice(12)

      if (url.endsWith('.html')) {
        if (url.startsWith('/'))
          url = url.slice(1)

        e.url = url === 'index.html' ? `${base}` : `${base}${url.slice(0, url.lastIndexOf('.'))}${suffix}`
      }
      else {
        e.url = url
      }

      return e
    })

    return { manifest }
  }
}

function buildGlobPatterns(globPatterns?: string[]): string[] {
  if (globPatterns) {
    if (!globPatterns.some(g => g.startsWith('prerendered/')))
      globPatterns.push('prerendered/**/*.html')

    if (!globPatterns.some(g => g.startsWith('client/')))
      globPatterns.push('client/**/*.{js,css,ico,png,svg,webp}')

    return globPatterns
  }

  return ['client/**/*.{js,css,ico,png,svg,webp}', 'prerendered/**/*.html']
}
