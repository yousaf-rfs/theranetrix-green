/** Keep the client demo on its single password-protected static entry point. */
export const previewViews = ['patients','review-queue','messages','schedule','care-pathways','patient-companion','settings','future-capabilities'] as const;
export type PreviewView = typeof previewViews[number];
export function previewHref(pathname: string, search = '', hash = ''): string | null {
  const params = new URLSearchParams(search);
  const chart = pathname.match(/^\/patients\/([^/]+)\/?$/);
  if (chart) {
    let patientId: string;
    try { patientId = decodeURIComponent(chart[1]); }
    catch { return null; }
    params.delete('view');
    params.set('patient', patientId);
    if (!params.has('tab')) params.set('tab','full');
  } else if (pathname === '/') {
    if (params.has('view') && !previewViews.includes(params.get('view') as PreviewView)) return null;
  } else if (['/engines','/pst','/shadow-ai','/digital-twin','/robo-advisor'].includes(pathname)) {
    params.set('view','patients'); params.set('open','treatment');
  } else {
    const view = pathname.replace(/^\//,'').replace(/\/$/,'') as PreviewView;
    if (!previewViews.includes(view)) return null;
    params.set('view',view);
  }
  return '/' + (params.size ? '?' + params.toString() : '') + hash;
}
