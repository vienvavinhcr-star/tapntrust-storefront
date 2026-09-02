from pathlib import Path

path = Path('index.html')
text = path.read_text()
start = text.index('  <!-- Google tag (gtag.js) -->')
end_marker = '  <!-- End Meta Pixel Code -->'
end = text.index(end_marker, start) + len(end_marker)
replacement = '''  <!-- Owner test-mode gate + analytics bootstrap -->
  <script>
    (() => {
      const TEST_MODE_KEY = 'tapntrust_test_mode';
      let requested = '';
      try { requested = new URLSearchParams(window.location.search).get('test') || ''; } catch {}
      try {
        if (requested === '1') localStorage.setItem(TEST_MODE_KEY, '1');
        else if (requested === '0') localStorage.removeItem(TEST_MODE_KEY);
      } catch {}
      let stored = false;
      try { stored = localStorage.getItem(TEST_MODE_KEY) === '1'; } catch {}
      const enabled = requested === '1' || (requested !== '0' && stored);
      window.TAPNTRUST_TEST_MODE = enabled;
      window['ga-disable-G-0MT4JK9R04'] = enabled;
      if (enabled) {
        document.documentElement.dataset.tapntrustTestMode = 'true';
        const noopFbq = function () {};
        noopFbq.loaded = true;
        noopFbq.version = '2.0';
        noopFbq.queue = [];
        window.fbq = noopFbq;
        window._fbq = noopFbq;
        return;
      }
      const ga = document.createElement('script');
      ga.async = true;
      ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-0MT4JK9R04';
      document.head.append(ga);
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', 'G-0MT4JK9R04');
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', '2121538478429149');
      window.fbq('track', 'PageView');
    })();
  </script>
  <noscript><img height="1" width="1" style="display:none" alt=""
  src="https://www.facebook.com/tr?id=2121538478429149&ev=PageView&noscript=1"
  /></noscript>'''
text = text[:start] + replacement + text[end:]
old = "      const scheduleClarity = () => {\n        const loadClarity = () => {"
new = "      const scheduleClarity = () => {\n        if (window.TAPNTRUST_TEST_MODE === true) return;\n        const loadClarity = () => {"
if old not in text:
    raise SystemExit('Expected Clarity scheduler block not found')
path.write_text(text.replace(old, new, 1))

agents = Path('AGENTS.md')
a = agents.read_text()
old_rule = "21. Tapntrust owner test mode must suppress both Microsoft Clarity and browser-side Meta Pixel/events on the owner's browser. `?test=1` enables the persistent browser flag and `?test=0` disables it. Do not weaken this suppression without explicit owner approval."
new_rule = "21. Tapntrust owner test mode must suppress Microsoft Clarity, browser-side Meta Pixel/events, and Google Analytics on the owner's browser. `?test=1` enables the persistent browser flag and `?test=0` disables it. Shopify and the Google Sheet lead funnel remain active for functional testing. Do not weaken this suppression without explicit owner approval."
if old_rule not in a:
    raise SystemExit('Expected AGENTS test-mode rule not found')
agents.write_text(a.replace(old_rule, new_rule, 1))

docs = Path('docs/ANALYTICS.md')
d = docs.read_text()
d = d.replace('- While active, `js/test-mode.js` opts out of Clarity, neutralises queued browser-side Meta Pixel calls, and `js/analytics/meta.js` refuses to initialize or emit Meta events.\n- `js/clarity-events.js` also refuses to emit Tapntrust Clarity funnel events.', '- While active, the early homepage gate prevents Google Analytics and the inline Meta Pixel bootstrap from loading, `js/test-mode.js` hard-blocks Clarity, and `js/analytics/meta.js` refuses to initialize or emit Meta events.\n- `js/clarity-events.js` also refuses to emit Tapntrust Clarity funnel events.\n- Shopify behavior and the Google Sheet welcome-lead funnel intentionally remain active so the owner can test commerce and lead capture.')
d = d.replace('GA is bootstrapped in HTML using measurement ID `G-0MT4JK9R04`. Owner test mode currently targets Clarity and Meta only; Google Analytics is unchanged. Do not add a second GA bootstrap without an explicit analytics migration plan.', 'GA uses measurement ID `G-0MT4JK9R04`. The homepage analytics bootstrap runs only when owner test mode is inactive; while `?test=1` is active, the GA script is not loaded and the `ga-disable-G-0MT4JK9R04` flag is set as a second guard. Do not add a second GA bootstrap without an explicit analytics migration plan.')
docs.write_text(d)
