/**
 * Texte des pages de règles (/docs/issues/<id>), une entrée par règle du
 * catalogue. Écrit d'après le code du moteur (engine.ts, indexing-checks.ts,
 * crawl.ts) : ce qui est mesuré ici doit rester vrai quand le moteur change.
 * Le test tests/rule-docs.test.mjs vérifie qu'aucune règle n'en manque.
 */
import type { RuleDoc } from "./rule-docs";

export const RULE_DOC_DATA = {
  "meta-title-missing": {
    "summary": "The page has no <title> element, or its <title> is empty. Browsers show the title in the tab and in bookmarks, and Google uses it, among other text, to write the clickable headline of the search result.",
    "failing": {
      "label": "Head rendered with an empty title",
      "lang": "html",
      "code": "<head>\n  <meta charset=\"utf-8\">\n  <!-- the template's title variable was undefined -->\n  <title></title>\n  <meta name=\"description\" content=\"Waterproof trail shoes for wet climates.\">\n</head>"
    },
    "measured": "Septune reads the first <title> element in the served HTML of each page, strips any tags inside it, decodes entities and trims spaces. The page is reported when there is no <title> at all or when its text ends up empty. Only pages that answer 2xx and have no noindex in a robots or googlebot meta tag are checked; a noindex sent only in an X-Robots-Tag header doesn't exempt a page, so preview deployments are still audited. JavaScript is not run, so a title set on the client is not seen.",
    "consequence": "Google builds the title link from other sources, such as the page's headings or the anchor text of links pointing to it, and the result may not say what you want. Tabs, bookmarks and history entries show the bare URL instead of a name.",
    "fix": "Render one <title> in the <head> of every page, written for that page: its subject first, then the site name if you want it. When the title comes from a template variable or a CMS field, give it a fallback so an empty tag is never sent, and set it on the server rather than from client-side JavaScript.",
    "frameworks": {
      "nextjs": "Export metadata or generateMetadata with a title from each page, and set title.default in the root layout's metadata so a page that forgets still gets one.",
      "nuxt": "Call useSeoMeta({ title }) or useHead({ title }) in each page and set app.head.title in nuxt.config.ts as the fallback.",
      "astro": "Declare title in the layout's Props interface and render <title>{title}</title> in its <head>, so type checking flags a page that doesn't pass one.",
      "sveltekit": "Add <svelte:head><title>{data.title}</title></svelte:head> to each +page.svelte, with the value returned by the route's load function."
    },
    "verify": "Run curl -s https://example.com/page | grep -io '<title[^>]*>[^<]*</title>' and check it prints a tag with text in it, then re-run the audit.",
    "related": [
      "structure-h1-multiple",
      "indexing-canonical-missing",
      "meta-title-duplicate",
      "meta-title-length"
    ]
  },
  "meta-title-duplicate": {
    "summary": "Two or more pages carry the same <title>. In search results and browser tabs they look identical, so the title no longer helps people or search engines tell the pages apart.",
    "failing": {
      "label": "Three pages, one title",
      "lang": "html",
      "code": "<!-- https://example.com/shoes/trail -->\n<title>Shoes | Example Store</title>\n\n<!-- https://example.com/shoes/running -->\n<title>Shoes | Example Store</title>\n\n<!-- https://example.com/shoes/hiking (case differs, still a duplicate) -->\n<title>shoes | example store</title>"
    },
    "measured": "Septune groups the crawled pages by title, after trimming spaces and ignoring case, and lists every page whose title is shared by at least one other, with the shared title as the note. Only exact matches count, so titles that differ by a single word are not grouped. A page with an empty title is not grouped either, since meta-title-missing covers it. Pages that answer something other than 2xx or carry a noindex meta tag are not compared, and neither are pages this crawl didn't reach.",
    "consequence": "Several results from your site show the same headline, so a searcher has to open them to find the right one. Google documents boilerplate titles repeated across pages as one of the cases where it rewrites title links.",
    "fix": "Put what is specific to the page first: the product, article or category name, then the shared site name. Duplicates usually come from a layout that hard-codes the title, or from paginated and filtered listings that reuse the base title; add the page number or the filter to those. If two pages really are the same, merge them instead.",
    "frameworks": {
      "nextjs": "Set title.template (for example '%s | Example Store') in the root layout and give each page its own title in metadata or generateMetadata; a page that sets none falls back to the layout's title.default.",
      "nuxt": "Set titleTemplate once in app.head in nuxt.config.ts and pass a page-specific value to useSeoMeta({ title }) in every page.",
      "astro": "Remove any literal <title> from the shared layout and build it from a prop that each page, or each content collection entry, supplies.",
      "sveltekit": "Render the <title> in each route's +page.svelte <svelte:head> from its own load data, not in +layout.svelte where every child route inherits it."
    },
    "verify": "Print the titles of two listed pages side by side with for u in /shoes/trail /shoes/running; do curl -s \"https://example.com$u\" | grep -io '<title[^>]*>[^<]*</title>'; done and check the lines differ, then re-run the audit.",
    "related": [
      "meta-title-missing",
      "meta-description-duplicate",
      "indexing-duplicate-content"
    ]
  },
  "meta-title-length": {
    "summary": "The title is shorter than 15 characters or longer than 65. A very short one says little about the page, and the end of a long one is cut off in search results.",
    "failing": {
      "label": "One title too short, one too long",
      "lang": "html",
      "code": "<!-- https://example.com/ : 4 characters -->\n<title>Home</title>\n\n<!-- https://example.com/blog/trail-shoes-guide : 99 characters -->\n<title>The Complete Guide to Choosing Trail Running Shoes for Wet, Muddy and Rocky Terrain | Example Store</title>"
    },
    "measured": "Septune takes the text of the first <title> on each 2xx page without a noindex meta tag, with inner tags stripped, entities decoded and runs of spaces collapsed. It lists titles under 15 characters or over 65, with the character count as the note; short ones come first. Empty titles are left to meta-title-missing. The 15 and 65 bounds are Septune's own guide, not a limit published by Google.",
    "consequence": "Google sets no length limit on <title>, but it truncates the title link to fit the device width, so the words at the end may never be seen. A one-word title such as \"Home\" or \"Blog\" gives the reader no reason to choose the result.",
    "fix": "Lead with the words that describe the page and keep the site name short, at the end. For short titles, add the subject: \"Home\" becomes \"Waterproof trail shoes | Example Store\". For long ones, drop slogans, keyword lists and repeated qualifiers. A title slightly over 65 characters that reads well can stay; treat the bound as a prompt to check.",
    "verify": "Open the page, run document.title.length in the DevTools console and check the number falls between 15 and 65, then re-run the audit.",
    "related": [
      "meta-title-missing",
      "meta-title-duplicate",
      "content-keyword-alignment"
    ]
  },
  "meta-description-missing": {
    "summary": "The page has no <meta name=\"description\">, or the tag is empty. The description is where you write the summary that can appear under your result; without it, Google picks text from the page on its own.",
    "failing": {
      "label": "Head with no description",
      "lang": "html",
      "code": "<head>\n  <meta charset=\"utf-8\">\n  <title>Trail shoes | Example Store</title>\n  <link rel=\"canonical\" href=\"https://example.com/shoes/trail\">\n  <!-- no <meta name=\"description\"> here -->\n</head>"
    },
    "measured": "Septune reads the content attribute of the first <meta name=\"description\"> in the served HTML. It reports the page when that tag is absent, has no content attribute, or holds only spaces. Pages are checked when they answer 2xx and carry no noindex in their robots or googlebot meta tag.",
    "consequence": "Google then builds the snippet from passages it selects in the page text. It may rewrite a description you provide as well, but without one it has no summary from you to start from.",
    "fix": "Write one or two sentences per page that say what the visitor gets there, with the facts a searcher compares: what it is, who it is for, and the price range or location when they apply. Avoid a single site-wide default, which only swaps this issue for meta-description-duplicate.",
    "frameworks": {
      "nextjs": "Add description to each page's metadata, or return it from generateMetadata built from the entry's excerpt or summary field.",
      "nuxt": "Pass description to useSeoMeta in each page component, filled from that page's data.",
      "astro": "Have each page pass a description prop to the layout, which renders <meta name=\"description\" content={description}> in its <head>.",
      "sveltekit": "Render <meta name=\"description\" content={data.description}> inside <svelte:head> in each +page.svelte."
    },
    "verify": "Run curl -s https://example.com/page | grep -io '<meta[^>]*name=\"description\"[^>]*>' and check the tag's content attribute is filled in, then re-run the audit.",
    "related": [
      "meta-title-missing",
      "meta-description-duplicate",
      "meta-og-image-missing"
    ]
  },
  "meta-description-duplicate": {
    "summary": "Several pages share the same meta description. Their results then carry the same summary, which tells searchers nothing about how the pages differ.",
    "failing": {
      "label": "Two pages, one description",
      "lang": "html",
      "code": "<!-- https://example.com/shoes/trail -->\n<meta name=\"description\" content=\"Shop the best shoes at Example Store. Free returns.\">\n\n<!-- https://example.com/shoes/running -->\n<meta name=\"description\" content=\"Shop the best shoes at Example Store. Free returns.\">"
    },
    "measured": "Septune groups pages by their meta description, compared after trimming and lowercasing, and lists every page whose description appears on at least one other page. Only exact matches are grouped, and only among the 2xx pages of this crawl that carry no noindex meta tag. Empty descriptions belong to meta-description-missing. The list gives the URLs but not the shared text.",
    "consequence": "Google's snippet documentation says identical or similar descriptions across a site's pages aren't helpful, and that it is less likely to display that kind of boilerplate. Results from your site that show up together for one query look interchangeable.",
    "fix": "Find where the shared text comes from: usually a default in the layout, or a CMS field left at its starting value. Replace it with a description per page. For large catalogs, build it from the fields that differ, such as name, category and a key attribute, rather than one sentence for all.",
    "frameworks": {
      "nextjs": "A page without its own description inherits the one in the root layout's metadata, so remove that default once pages set theirs, or set it per route segment.",
      "nuxt": "A description in nuxt.config.ts app.head applies to every route; override it with useSeoMeta({ description }) in each page."
    },
    "verify": "Fetch two listed pages in one call with curl -s https://example.com/shoes/trail https://example.com/shoes/running | grep -io '<meta[^>]*name=\"description\"[^>]*>' and check the two lines differ, then re-run the audit.",
    "related": [
      "meta-description-missing",
      "meta-title-duplicate",
      "indexing-duplicate-content"
    ]
  },
  "meta-og-image-missing": {
    "summary": "The page has no og:image meta tag. When someone shares the link on a social network or in a chat app, the preview card has no image you chose.",
    "failing": {
      "label": "Open Graph tags without an image",
      "lang": "html",
      "code": "<head>\n  <title>Trail shoes | Example Store</title>\n  <meta property=\"og:title\" content=\"Trail shoes\">\n  <meta property=\"og:description\" content=\"Waterproof trail shoes for wet climates.\">\n  <meta property=\"og:url\" content=\"https://example.com/shoes/trail\">\n  <meta property=\"og:type\" content=\"website\">\n  <!-- no og:image -->\n</head>"
    },
    "measured": "Septune looks inside the <head> of every page that answers 2xx, noindexed pages included, for a <meta property=\"og:image\"> with a non-empty content attribute. A tag written with name= instead of property=, or only og:image:url, doesn't count, and neither does a tag outside <head> or one added by JavaScript. The image URL itself is not fetched by this rule.",
    "consequence": "The card is left to each platform: some show a text-only preview, others pick an image from the page on their own. The Open Graph protocol lists og:image among the four properties every page should declare, with og:title, og:type and og:url.",
    "fix": "Set a default og:image in the shared layout, then override it on pages that have their own picture, such as products and articles. Point it to an absolute https URL of an image that answers 200 without authentication.",
    "frameworks": {
      "nextjs": "Prefer the app/opengraph-image file convention to openGraph.images in the layout, because a page that sets its own openGraph metadata replaces the layout's whole openGraph object, images included.",
      "nuxt": "Call useSeoMeta({ ogImage: 'https://example.com/og/default.png' }) in app.vue for the default and again in the pages that have their own image.",
      "astro": "Render <meta property=\"og:image\" content={new URL(image, Astro.site).href}> in the layout's <head>, with a default value for the image prop, so the URL is always absolute.",
      "sveltekit": "Emit og:image once, in +layout.svelte's <svelte:head>, from a value each route returns in its load data with a site-wide fallback, since Svelte doesn't merge duplicate head tags."
    },
    "verify": "Fetch the page as a share crawler would, with curl -s -A 'facebookexternalhit/1.1' https://example.com/page | grep -io '<meta[^>]*og:image[^>]*>', check the card in the platform's own preview tool (LinkedIn Post Inspector, for example), then re-run the audit.",
    "related": [
      "indexing-canonical-missing",
      "structure-h1-multiple",
      "meta-description-missing",
      "meta-title-missing"
    ]
  },
  "meta-og-image-url": {
    "summary": "The page declares an og:image, but as a relative path or a localhost address. Social networks and chat apps fetch the picture from their own servers, so the shared card comes out without it.",
    "failing": {
      "label": "og:image tags no share crawler can load",
      "lang": "html",
      "code": "<!-- /pricing: a path with no host -->\n<meta property=\"og:image\" content=\"/images/og-pricing.png\">\n\n<!-- /blog/launch: resolved against the build machine -->\n<meta property=\"og:image\" content=\"http://localhost:3000/blog/launch/opengraph-image.png\">"
    },
    "measured": "Septune reads the og:image meta of every page that answers 2xx and checks the value without fetching it. A value with no scheme, such as /og.png or images/og.png, is reported as relative. An http or https URL whose host is localhost, 0.0.0.0, ::1 or a 127.x address is reported, unless the audited site runs on localhost too. Another scheme, such as data:, is reported as well. A protocol-relative value (//cdn.example.com/og.png) passes, and pages with no og:image at all are left to meta-og-image-missing.",
    "consequence": "A localhost address points at the crawler's own machine, so that image can never load. A relative path works only on platforms that resolve it against the page address, which the Open Graph protocol doesn't ask them to do: every example on ogp.me uses a full URL. The link still shares, with a text-only card or a picture the platform picked by itself.",
    "fix": "Write the image as an absolute https URL on the production domain, built from one setting that holds the site's origin, so a preview or local build can't leak its own host into production. Then open that URL in a private window to check it answers 200 without a login.",
    "frameworks": {
      "nextjs": "Set metadataBase: new URL('https://example.com') in the root layout's metadata. Next.js resolves relative openGraph.images, twitter.images and alternates.canonical against it. Without it, images fall back to the deployment URL on Vercel and to http://localhost:3000 elsewhere, with a warning that names the origin used.",
      "nuxt": "Pass the full URL to useSeoMeta({ ogImage }) or to app.head in nuxt.config.ts; plain Nuxt writes the value into the tag as given.",
      "astro": "Build the value with new URL(image, Astro.site) and set site in astro.config.mjs. Without site, Astro.site is undefined and the URL constructor throws on a relative path, which at least fails the build instead of shipping a broken card.",
      "sveltekit": "Prefix the path with the production origin from a public environment variable. During prerendering, url.origin is http://sveltekit-prerender unless kit.prerender.origin is set, so an origin read from the request ends up in the static HTML."
    },
    "verify": "Run curl -s https://example.com/pricing | grep -io '<meta[^>]*og:image[^>]*>' and check the URL starts with https:// on your own domain, load it in a private window, then re-run the audit.",
    "related": [
      "meta-og-image-missing",
      "indexing-canonical-mismatch",
      "img-broken"
    ]
  },
  "content-keyword-alignment": {
    "summary": "The words the page's text is mostly about don't appear in its title or its H1. The search result and the heading then promise something other than what the page covers, or name it in words nobody searches for.",
    "failing": {
      "label": "Title and H1 that never name the subject",
      "lang": "html",
      "code": "<head>\n  <title>Welcome | Example Store</title>\n</head>\n<body>\n  <h1>Hello there</h1>\n  <p>Our waterproof trail shoes use a breathable membrane and a lugged\n     outsole. Each waterproof model is tested on wet rock and mud before\n     it goes on sale, and every trail shoe ships with spare laces.</p>\n  <!-- 600 more words about waterproof trail shoes -->\n</body>"
    },
    "measured": "For each 2xx page without a noindex meta tag and with at least 200 words, Septune scores the words of the first 12,000 characters of visible text by TF-IDF across all crawled pages, so words found on every page, like menu items, weigh less. English stop words, pure numbers and words under 3 or over 24 letters are dropped. The page is reported when none of its top 5 terms appears in the title or any H1, matched as whole words after a light stemmer removes a final -ing, -ed, -es or -s. The note shows the top 3 terms, and at most 40 pages are listed. Letters outside a to z split words, so the check is only reliable on English text.",
    "consequence": "Searchers judge a result by its title, and a title that doesn't name the subject is easy to pass over. Google's title link documentation lists titles that don't reflect what the page is about among the cases where it writes its own.",
    "fix": "Read the terms in the note. If they describe the page, use the main one in the title and the H1, in the words people would search. If they come from a cookie notice, a repeated widget or a menu, the crawler sees little real content, so check that the main text is in the server HTML. The rule is a heuristic with a confidence of 55: a title that uses an accurate synonym can be left as it is.",
    "verify": "Open view-source, look for the main term from the note, and check it appears inside <title> and <h1>, then re-run the audit.",
    "related": [
      "meta-title-length",
      "structure-h1-missing",
      "content-keyword-stuffing"
    ]
  },
  "indexing-noindex": {
    "summary": "A page that should be findable tells search engines not to index it, through a robots meta tag or an X-Robots-Tag response header. Google drops a noindexed page from its results when it next crawls it, so one stray directive in a shared template can remove a whole section of the site.",
    "failing": {
      "label": "Product page whose header contradicts its meta tag",
      "lang": "http",
      "code": "HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\nX-Robots-Tag: noindex\n\n<!doctype html>\n<html lang=\"en\">\n<head>\n  <title>Trail running shoes | Example</title>\n  <meta name=\"robots\" content=\"index, follow\">\n</head>"
    },
    "measured": "For every crawled page that answers 2xx, Septune reads the first <meta name=\"robots\"> tag, the first <meta name=\"googlebot\"> tag and the X-Robots-Tag header of the final response. A value containing noindex or none counts. In the header, a directive scoped to another crawler (bingbot: noindex) is ignored and one scoped to googlebot counts. Pages whose path has a sign-in, account, cart, checkout, search or similar segment go to indexing-noindex-utility instead, unless they are listed in the sitemap or are the start page. Every remaining page is listed with the source of its noindex, plus \"listed in the sitemap\" or \"the start page\" when that applies.",
    "consequence": "Each listed page can leave Google's results on its next crawl. A listed start page or sitemap URL is a contradiction: the site asks for the page to be indexed and refuses it in the same breath.",
    "fix": "Find where the directive is emitted. A meta tag usually comes from a shared layout or an SEO setting left on from staging. A header comes from the server, the CDN or the host configuration and never shows in the page source. Remove it from pages that should rank. Some hosts add X-Robots-Tag: noindex to preview deployments, so audit the production URL. When the tag and the header disagree, Google follows the more restrictive one, so both have to allow indexing.",
    "frameworks": {
      "nextjs": "Search for robots: { index: false } in metadata and generateMetadata (a value in a layout applies to every page below it unless the page overrides it), and for an X-Robots-Tag entry in the headers() function of next.config.",
      "nuxt": "Search useSeoMeta and useHead calls and app.head in nuxt.config.ts for a robots value of noindex, and check routeRules for an X-Robots-Tag header.",
      "astro": "The tag is usually hard-coded in the layout's <head>; render it only when the page passes a prop that asks for it.",
      "sveltekit": "Check <svelte:head> in +layout.svelte for a robots meta tag, and the handle function in hooks.server.ts for code that sets X-Robots-Tag on every response."
    },
    "verify": "Run curl -sI https://example.com/page | grep -i x-robots-tag to see the header, and search view-source for name=\"robots\". Search Console's URL Inspection reports whether indexing is allowed. Then re-run the audit.",
    "related": [
      "indexing-noindex-utility",
      "indexing-robots-blocks-pages",
      "indexing-sitemap-hygiene"
    ]
  },
  "indexing-noindex-utility": {
    "summary": "Sign-in, account, cart, checkout and similar pages carry a noindex. That is normally intended, so Septune reports it as a low-impact notice for review. The risk is a public page whose path happens to use one of those words, such as a pre-order or waitlist landing page.",
    "failing": {
      "label": "Head of an account page kept out of search",
      "lang": "html",
      "code": "<!-- https://example.com/account/orders -->\n<head>\n  <title>Your orders | Example</title>\n  <meta name=\"robots\" content=\"noindex, nofollow\">\n</head>"
    },
    "measured": "This takes the 2xx pages with a noindex (robots or googlebot meta tag, or X-Robots-Tag header) and keeps those whose URL path contains a whole segment from a fixed list: login, log-in, signin, sign-in, signup, sign-up, register, logout, log-out, signout, sign-out, account, my-account, profile, settings, dashboard, admin, auth, oauth, callback, password, forgot-password, reset-password, verify, cart, basket, checkout, thank-you, thanks, confirmation, search, unsubscribe, preview, preorder, pre-order, waitlist. Segments are compared case-insensitively, with a .html, .htm or .php extension ignored. A page listed in the sitemap, or the start page, is never put here. Each URL's note says where the noindex comes from.",
    "consequence": "Usually nothing: these pages have no content worth ranking. It costs something only when a page on the list was meant to be found, because it stays out of results without anyone noticing.",
    "fix": "Read the list and confirm each page. Keep the noindex on private and transactional pages. If one of them should rank, remove its noindex and add it to the sitemap; it will then be checked under indexing-noindex. Don't also disallow these pages in robots.txt, because Google has to crawl a page to see its noindex.",
    "verify": "Open each listed URL as view-source: and confirm the robots meta tag, or look for X-Robots-Tag in curl -sI output, then re-run the audit. A page you made indexable should no longer appear here.",
    "related": [
      "indexing-noindex",
      "indexing-sitemap-hygiene"
    ]
  },
  "indexing-robots-unavailable": {
    "summary": "/robots.txt answers with a server error (5xx) or 429 Too Many Requests. Google treats those answers as if the whole site were disallowed, so it stops crawling until the file answers normally again.",
    "failing": {
      "label": "robots.txt request hitting a failing server",
      "lang": "http",
      "code": "GET /robots.txt HTTP/1.1\nHost: example.com\n\nHTTP/1.1 503 Service Unavailable\nContent-Type: text/html\nRetry-After: 300"
    },
    "measured": "Septune requests /robots.txt on the start URL's origin, following redirects, with an 8-second timeout, and reads the final status. It reports a status of 500 or higher, or exactly 429. A timeout or a refused connection yields no status and isn't reported; a 404 or any other answer without a usable file shows up under framework-robots-missing.",
    "consequence": "While the error lasts, Googlebot doesn't crawl the site's pages: new URLs aren't discovered and changes aren't picked up. Google's documentation says that if the file stays unreachable for more than 30 days, it falls back to its last cached copy, or to no restrictions when it has none.",
    "fix": "Make /robots.txt something that can't fail: a static file served without going through the application, a database or a CMS. If it has to be generated, catch errors and return a fixed set of rules. A rate limiter or bot shield that answers 429 should exempt this path. If you have no rules at all, a 404 is fine: Google reads a 4xx other than 429 as no restrictions.",
    "frameworks": {
      "nextjs": "If app/robots.ts awaits a CMS or database call, wrap it in try/catch and return default rules, or replace it with public/robots.txt.",
      "nuxt": "Put the file in public/robots.txt so Nitro serves it as a static asset rather than through a server route.",
      "astro": "Use public/robots.txt, which is copied to the build as-is, instead of an on-demand endpoint that queries data.",
      "sveltekit": "Ship static/robots.txt, or add export const prerender = true to a src/routes/robots.txt/+server.ts endpoint so it is built once."
    },
    "verify": "Run curl -s -o /dev/null -w '%{http_code}\\n' https://example.com/robots.txt a few times, including while the site is under load, and expect 200 (or 404). Search Console's robots.txt report shows the fetch status Google last got. Then re-run the audit.",
    "related": [
      "framework-robots-missing",
      "indexing-robots-html",
      "indexing-robots-blocks-google"
    ]
  },
  "indexing-robots-blocks-google": {
    "summary": "robots.txt disallows the root path / for Googlebot, either in a group that names Googlebot or in the * group it falls back to. Google can't crawl the homepage or any path that a longer Allow rule doesn't reopen, which usually means a staging robots.txt reached production.",
    "failing": {
      "label": "Staging robots.txt served in production",
      "lang": "text",
      "code": "# robots.txt copied from staging\nUser-agent: *\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml"
    },
    "measured": "When /robots.txt answers 2xx with a non-HTML body, Septune evaluates it for the path / as Googlebot: the groups naming Googlebot are used, and the * group only when no group names it. Among the rules that match, the longest wins and Allow wins a tie; * wildcards and a trailing $ are understood. The rule fires when / comes out disallowed. Only / is tested, so a file that blocks everything except the homepage (Allow: /$) is reported under indexing-robots-blocks-pages instead.",
    "consequence": "Googlebot stops fetching the site. URLs that other sites link to can still appear in results, but without a description, since Google can't read the pages. AI Overviews and AI Mode are fed by Googlebot, so the site drops out of those as well.",
    "fix": "Remove Disallow: / (or Disallow: /*) from the group that applies to Googlebot in production, and keep Disallow lines only for paths that really shouldn't be crawled. If staging needs to stay out of search, generate robots.txt from the deployment environment instead of committing a blocking file, and put staging behind authentication.",
    "frameworks": {
      "nextjs": "In app/robots.ts, check the condition that returns disallow: '/'; an environment check that reads the wrong variable ships the staging rules to production."
    },
    "verify": "Fetch the live file with curl -s https://example.com/robots.txt and read the group that applies to Googlebot. In Search Console, a live URL Inspection test of the homepage says whether crawling is allowed. Then re-run the audit.",
    "related": [
      "indexing-robots-blocks-pages",
      "indexing-robots-format",
      "indexing-robots-unavailable"
    ]
  },
  "indexing-robots-blocks-pages": {
    "summary": "robots.txt leaves the site root open but disallows some pages Septune crawled for Googlebot. Google can't read those pages, so their content can't rank, although a bare URL may still be listed.",
    "failing": {
      "label": "robots.txt with a Googlebot group that is too broad",
      "lang": "text",
      "code": "User-agent: Googlebot\nDisallow: /shop/\nDisallow: /*?sort=\n\nUser-agent: *\nDisallow: /cart"
    },
    "measured": "When robots.txt is readable and / is allowed, Septune tests the path and query string of every crawled 2xx page against the Googlebot rules, with the same matching as for the root (Googlebot group first, * group otherwise, longest rule wins, Allow wins a tie). Pages that carry a noindex are left out. Septune's crawler obeys the rules that apply to its own user agent, SeptuneBot, which is usually the * group, so a page blocked there isn't fetched and can't be listed unless the audit ignores robots.txt for your own site. Every matching page is listed.",
    "consequence": "Googlebot doesn't fetch the listed pages, so their text, links and structured data don't count. A link from elsewhere can still get the URL indexed without a snippet, and a noindex added later stays invisible while the block remains.",
    "fix": "For each page, decide whether it belongs in search. If it does, narrow or delete the Disallow rule that matches it; a prefix such as Disallow: /shop also matches /shop-guides and /shopping. If it doesn't, remove the Disallow and put a noindex on the page, which only works on a page Google may crawl. Once a group names Googlebot, Googlebot ignores the * group entirely, so any rule it should follow has to be repeated in its own group.",
    "verify": "In Search Console, inspect one listed URL: the page indexing details say whether crawling is allowed, and the robots.txt report shows the version Google fetched. Then re-run the audit.",
    "related": [
      "indexing-robots-blocks-google",
      "indexing-noindex",
      "indexing-robots-format"
    ]
  },
  "indexing-robots-html": {
    "summary": "Requesting /robots.txt returns an HTML document with a 2xx status, typically the app shell a single-page app serves for every path. Crawlers find no rules and no Sitemap line in it, so the site effectively has no robots.txt.",
    "failing": {
      "label": "SPA fallback answering for /robots.txt",
      "lang": "http",
      "code": "GET /robots.txt HTTP/1.1\nHost: example.com\n\nHTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\n\n<!doctype html>\n<html lang=\"en\">\n<head><title>Example</title></head>\n<body><div id=\"root\"></div><script type=\"module\" src=\"/assets/index-4f2a.js\"></script></body>\n</html>"
    },
    "measured": "Septune requests /robots.txt with redirects followed and reports it when the final status is 2xx and the Content-Type header contains text/html. Only the header is checked, not the body. The body is then discarded: the robots.txt rule checks (blocks-google, blocks-pages, format) don't run, no Sitemap line is read from it, and framework-robots-missing is raised as well.",
    "consequence": "Google skips lines it can't parse, so the HTML gives it no rules at all. Any Disallow you meant to publish isn't applied, and search engines don't learn the sitemap location from robots.txt.",
    "fix": "Create a real robots.txt and serve it as text/plain from a path the router matches before its fallback. On a static host with a single-page app, put the file in the folder copied to the build output unchanged, and check that the rewrite to index.html doesn't catch /robots.txt. If the file exists but the server labels it text/html, correct the Content-Type.",
    "frameworks": {
      "nextjs": "Add app/robots.ts or public/robots.txt; both are matched before a catch-all route such as app/[...slug]/page.tsx.",
      "nuxt": "Place robots.txt in public/ so Nitro answers with the file before the catch-all page renders.",
      "astro": "Add public/robots.txt, or an endpoint at src/pages/robots.txt.ts whose GET returns a Response with Content-Type: text/plain.",
      "sveltekit": "Put robots.txt in static/, or add src/routes/robots.txt/+server.ts returning a text/plain Response."
    },
    "verify": "Run curl -sI https://example.com/robots.txt and check for a 200 with Content-Type text/plain, then curl -s the same URL and confirm it starts with User-agent lines rather than <!doctype html>. Then re-run the audit.",
    "related": [
      "framework-robots-missing",
      "framework-robots-no-sitemap",
      "indexing-soft-404-site"
    ]
  },
  "indexing-robots-format": {
    "summary": "robots.txt has lines with an unknown or misspelled directive, no colon, or a Noindex directive. Crawlers skip lines they can't parse, so whatever rule was written on them has no effect.",
    "failing": {
      "label": "robots.txt with a typo, a missing colon and a Noindex line",
      "lang": "text",
      "code": "User-agent: *\nDissallow: /admin\nDisallow /checkout\nNoindex: /tag/\n\nSitemap: https://example.com/sitemap.xml"
    },
    "measured": "When robots.txt answers 2xx with a non-HTML body (read up to 100,000 characters), Septune drops # comments and blank lines and reads the name before the first colon of each remaining line, case-insensitively. It reports a line with no colon or nothing before it, a Noindex line, and any other name outside User-agent, Allow, Disallow, Sitemap, Crawl-delay, Host, Clean-param, Request-rate and Visit-time. The evidence gives the total count, and the note quotes the first three problems with their line numbers.",
    "consequence": "A misspelled Disallow leaves its path crawlable. Google has ignored Noindex in robots.txt since September 2019, so pages meant to leave the index stay in it. Crawl-delay passes this check, but Google doesn't support it either.",
    "fix": "Correct each reported line to a directive name, a colon, then the value, as in Disallow: /checkout. To keep a page out of the index, delete the Noindex line and put a robots meta tag or an X-Robots-Tag header on the page itself, leaving the page crawlable so Google can read it.",
    "frameworks": {
      "nextjs": "Generate the file from app/robots.ts typed as MetadataRoute.Robots: TypeScript rejects a misspelled field, and Next.js writes each directive with its colon."
    },
    "verify": "Run curl -s https://example.com/robots.txt | cat -n, which numbers lines the way Septune's note does, and fix the lines it named. Search Console's robots.txt report also lists the problems Google found in the fetched file. Then re-run the audit.",
    "related": [
      "indexing-robots-blocks-pages",
      "indexing-noindex",
      "framework-robots-no-sitemap"
    ]
  },
  "indexing-broken-page": {
    "summary": "Pages that Septune reached from the start URL, internal links or the sitemap answer with a 4xx or 5xx status. Visitors following those links hit an error, and Google removes URLs that keep answering 4xx from its index.",
    "failing": {
      "label": "A linked blog post that no longer exists",
      "lang": "http",
      "code": "GET /blog/spring-sale-2024 HTTP/1.1\nHost: example.com\n\nHTTP/1.1 404 Not Found\nContent-Type: text/html; charset=utf-8\nCache-Control: no-store"
    },
    "measured": "Septune lists every crawled page whose final status, after redirects, is 400 or higher, with the status in the note. Crawled pages are the start URL, same-origin links found in the HTML and sitemap URLs no link reached, up to the crawl's page limit. A link that redirects to an error is listed under the URL it landed on. A request that times out (12 seconds) or can't connect has no status and isn't listed.",
    "consequence": "Every link to these URLs is a dead end for visitors and crawlers alike. URLs that keep answering 4xx are dropped from Google's index, and repeated 5xx answers make Googlebot slow its crawling of the site.",
    "fix": "Start from the status. A 404 or 410 on a page that moved needs a permanent redirect to the new URL, and the internal links should be updated to point there directly. A page removed on purpose keeps its 404 or 410, but its links and sitemap entry should go. A 5xx means the route itself fails: check the server logs for those URLs. A 403 can come from a bot filter rather than the page, so compare with a request from a browser.",
    "frameworks": {
      "nextjs": "Declare moved URLs in the redirects() function of next.config with permanent: true, which answers 308.",
      "nuxt": "Add the old path to routeRules in nuxt.config.ts with redirect: { to: '/new-path', statusCode: 301 }.",
      "astro": "List the old path in the redirects option of astro.config.mjs; a static build without an adapter turns it into a meta refresh page, so use the host's redirect rules there.",
      "sveltekit": "In the old route's +page.server.ts load function, call redirect(301, '/new-path') from @sveltejs/kit."
    },
    "verify": "For each listed URL, run curl -sL -o /dev/null -w '%{http_code} %{url_effective}\\n' https://example.com/old-path and expect a 200 on the final URL, or a deliberate 404 or 410 with no internal link left pointing at it. Then re-run the audit.",
    "related": [
      "link-broken-internal",
      "indexing-sitemap-hygiene",
      "indexing-soft-404"
    ]
  },
  "indexing-soft-404-site": {
    "summary": "A URL that can't exist on the site gets a 2xx answer, either directly or after a redirect to another page such as the homepage. The server never says \"not found\", so every mistyped, removed or invented URL looks like a real page.",
    "failing": {
      "label": "Probe for a missing path redirected to the homepage",
      "lang": "http",
      "code": "GET /septune-404-check-k3v9q2xa HTTP/1.1\nHost: example.com\n\nHTTP/1.1 302 Found\nLocation: https://example.com/\n\nGET / HTTP/1.1\nHost: example.com\n\nHTTP/1.1 200 OK"
    },
    "measured": "Septune requests one path that can't exist, /septune-404-check- followed by a random suffix, on the start URL's origin, following redirects with an 8-second timeout. It reports the site when the final status is 2xx. If the request ended on another path, the note names where it landed; otherwise it gives the status the missing page answered with. There is one probe per audit, so this is a single site-wide finding, not a list of pages.",
    "consequence": "Google lists such URLs as soft 404s in Search Console's Page indexing report and still spends crawl requests on them. Removed pages never fail, so stale links can't be found from status codes, and redirecting many unrelated URLs to the homepage can itself be read as a soft 404.",
    "fix": "Make the fallback route answer 404 (or 410) while still showing a helpful error page. With a single-page app on a static host, the usual cause is a rewrite that sends every path to index.html with a 200: render unknown routes as a 404 at the server or edge, or prerender the known routes and let the host serve a 404 page for the rest. Don't redirect unknown paths to the homepage.",
    "frameworks": {
      "nextjs": "Unknown paths get app/not-found.tsx with a 404 unless a catch-all such as app/[...slug]/page.tsx renders them; call notFound() there when the slug matches nothing.",
      "nuxt": "In a catch-all pages/[...slug].vue, throw createError({ statusCode: 404 }) when the content lookup returns nothing, so the error page renders with a 404.",
      "astro": "A static build emits src/pages/404.astro as 404.html; check that the host serves it with a 404 for unknown paths and that no rewrite sends them to index.html.",
      "sveltekit": "Look for a catch-all src/routes/[...path] route that renders for every URL, and make its load function call error(404) when nothing matches."
    },
    "verify": "Run curl -sIL https://example.com/no-such-page-7f3k | grep -iE '^(HTTP|location)' and expect a single 404 status line with no Location header. Then re-run the audit.",
    "related": [
      "indexing-soft-404",
      "indexing-broken-page",
      "indexing-robots-html"
    ]
  },
  "indexing-soft-404": {
    "summary": "Some crawled pages answer 200 but read like an error page: the title or main heading says \"not found\" or 404, and there is little text. Search engines classify them as soft 404s and keep them out of the index, while the server keeps reporting success.",
    "failing": {
      "label": "A product URL whose record is gone, served with 200",
      "lang": "html",
      "code": "<!-- https://example.com/products/blue-kettle, HTTP 200 -->\n<head>\n  <title>Page not found | Example</title>\n</head>\n<body>\n  <h1>Sorry, this page could not be found.</h1>\n  <a href=\"/\">Back to the homepage</a>\n</body>"
    },
    "measured": "Among crawled pages that answer 2xx, Septune flags those with fewer than 250 words of visible body text (script, style, noscript and template content excluded) whose <title> or first <h1> matches an error pattern: the number 404 set off by spaces, a pipe, a colon, a hyphen or an en dash, or at the start or end; \"page not found\" or \"page was not found\"; \"could not be found\", \"can't be found\" or \"cannot be found\"; a title or heading that is only \"not found\"; or the French, German, Spanish, Italian and Dutch wording of \"page not found\". Matching ignores case. The note shows the first 60 characters of the H1, or of the title when there is no H1.",
    "consequence": "Google doesn't index pages it classes as soft 404s and lists them in Search Console's Page indexing report. If your own pages link to them, those links lead to an error that the status code hides.",
    "fix": "Find why the route renders an error with a 200. Most often a dynamic page catches a missing record and prints a message instead of setting the status. Return 404 when the content doesn't exist, 410 when it was removed for good, or a permanent redirect when it moved. If the page is real and simply short, reword the title or H1 so it no longer reads as an error.",
    "frameworks": {
      "nextjs": "Call notFound() from next/navigation as soon as the record lookup comes back empty, rather than rendering a \"not found\" message from the page component.",
      "nuxt": "When useFetch or useAsyncData returns no record, throw createError({ statusCode: 404, statusMessage: 'Not found' }) instead of rendering an empty state.",
      "astro": "In an on-demand route, set Astro.response.status = 404 when the item is missing; with getStaticPaths, don't return a path for it at all.",
      "sveltekit": "In the route's load function, call error(404) from @sveltejs/kit when the item lookup returns nothing; +error.svelte then renders with that status."
    },
    "verify": "Run curl -s -o /dev/null -w '%{http_code}\\n' on each listed URL and expect 404, 410 or a 3xx. Search Console's URL Inspection shows whether Google classed the page as a soft 404. Then re-run the audit.",
    "related": [
      "indexing-soft-404-site",
      "indexing-broken-page",
      "structure-thin-content"
    ]
  },
  "indexing-canonical-missing": {
    "summary": "An indexable page has no <link rel=\"canonical\">. Without one, Google picks the canonical itself among the URLs that serve the same content, such as copies with tracking parameters, and the URL it shows may not be the one you would choose.",
    "failing": {
      "label": "Head of a product page with no canonical",
      "lang": "html",
      "code": "<head>\n  <meta charset=\"utf-8\">\n  <title>Trail running shoes | Example</title>\n  <meta name=\"description\" content=\"Light shoes for rough ground.\">\n  <!-- no <link rel=\"canonical\"> anywhere -->\n</head>"
    },
    "measured": "Septune checks every page that answers 2xx and has no noindex (or none) in a robots or googlebot meta tag. Pages noindexed only by an X-Robots-Tag header still count, on purpose, because preview deployments send that header on every page and their audits must stay comparable. It looks for the first <link> in the HTML whose rel is exactly \"canonical\" in quotes, and reads its quoted href. The page is reported when there is no such tag or the href is empty. A canonical sent in an HTTP Link header is not read. Every affected URL is listed, and the evidence gives the count out of all indexable pages.",
    "consequence": "Google decides the canonical on its own for these pages, so signals from links can land on a parameter variant instead of the clean URL.",
    "fix": "Give every indexable page a self-referencing canonical: an absolute URL on your production host, without query parameters, built from the page's own path. Set it once in the shared layout so new pages get it by default, and override it only on pages that copy another one.",
    "frameworks": {
      "nextjs": "In app/layout.tsx, set metadataBase to your production origin and alternates: { canonical: \"./\" }; Next.js resolves \"./\" against each route, while \"/\" would point every page at the homepage.",
      "nuxt": "In app.vue, call useHead with a canonical link whose href is computed from useRoute().path and your production origin.",
      "astro": "In the shared layout's <head>, add <link rel=\"canonical\" href={new URL(Astro.url.pathname, Astro.site)} /> and set site in astro.config.mjs.",
      "sveltekit": "In src/routes/+layout.svelte, put the link inside <svelte:head> with an href built from page.url.pathname (page from $app/state) and your production origin."
    },
    "verify": "Run curl -s https://example.com/shoes | grep -io '<link[^>]*rel=\"canonical\"[^>]*>' and check it prints one tag holding the page's own absolute URL, then re-run the audit.",
    "related": [
      "indexing-canonical-mismatch",
      "indexing-canonical-multiple",
      "indexing-duplicate-content"
    ]
  },
  "indexing-canonical-mismatch": {
    "summary": "A page's canonical names another path on the same site. That tells Google this page is a copy of the other one, so it can drop the page from results. When many pages share the same wrong value, a shared layout usually writes a fixed href.",
    "failing": {
      "label": "Product page whose canonical points at the homepage",
      "lang": "html",
      "code": "<!-- https://example.com/products/trail-shoe -->\n<head>\n  <title>Trail shoe | Example</title>\n  <link rel=\"canonical\" href=\"https://example.com/\">\n</head>"
    },
    "measured": "Septune reads the canonical of every crawled page with a 2xx status, noindexed ones included. It reports the page when the canonical resolves to the same origin as the audited URL but to a different path. Paths are compared without the trailing slash, the query string or the fragment, so /shoes?color=red pointing at /shoes is not reported. Canonicals on another host are left out on purpose: a cross-domain canonical can be deliberate and Septune can't judge it. Each listed page carries its canonical exactly as written in the HTML.",
    "consequence": "Google may index the canonical's target in place of this page, which then stops showing for its own queries.",
    "fix": "Decide page by page. If the page has its own content, its canonical must be its own URL. If it really is a variant of the target (a print version, a sorted listing), keep the canonical as it is. A wrong value repeated across many pages means the layout needs an href built from the current path.",
    "frameworks": {
      "nextjs": "alternates: { canonical: \"/\" } in the root layout is inherited by every page and resolves to the homepage; use \"./\" with metadataBase so each route resolves to itself.",
      "nuxt": "A canonical declared in nuxt.config.ts app.head is identical on every page; move it to useHead in app.vue with an href computed from the current route.",
      "astro": "A literal href, or Astro.site alone, in the layout gives every page the same canonical; build it from Astro.url.pathname.",
      "sveltekit": "A fixed href in the <svelte:head> of +layout.svelte applies to every child route; build it from page.url.pathname, or set the canonical in each +page.svelte."
    },
    "verify": "Open a listed page's source, find the canonical and check its path matches the address bar; Search Console URL inspection shows which canonical Google selected. Re-run the audit afterwards, knowing that pages you canonicalise elsewhere on purpose will stay listed.",
    "related": [
      "indexing-canonical-target-invalid",
      "indexing-canonical-missing",
      "indexing-duplicate-content"
    ]
  },
  "indexing-canonical-target-invalid": {
    "summary": "A page names a canonical URL that answers with an error, redirects, or is set to noindex. The canonical should be the final, indexable version of the content; aimed at a dead end, it gives Google a hint it can't follow.",
    "failing": {
      "label": "Canonical aimed at a URL that now redirects",
      "lang": "html",
      "code": "<!-- https://example.com/blog/spring-sale -->\n<head>\n  <link rel=\"canonical\" href=\"https://example.com/blog/sale\">\n</head>\n\n<!-- GET https://example.com/blog/sale -->\n<!-- 301 Moved Permanently, Location: /blog/spring-sale -->"
    },
    "measured": "For every 2xx page whose canonical resolves to another URL (scheme, host and path compared, trailing slash and query string ignored), Septune looks the target up among the pages it crawled. The page is reported when the target answered 400 or above, was reached through a redirect, or carries noindex in a robots meta tag or an X-Robots-Tag header; the note says which. A target the crawl never fetched, on another host or past the page limit, is skipped as unchecked rather than counted as broken.",
    "consequence": "Google receives a canonical it can't honour and chooses one on its own, which may be neither the page nor the target you meant.",
    "fix": "Point the canonical at the URL the target finally resolves to: the one that answers 200 and has no noindex. After a slug change or a migration, update the data the canonical is generated from (a CMS field, a route list) so it follows the new URLs. If the target is noindex on purpose, use the page's own URL as canonical instead.",
    "verify": "Run curl -sI on the canonical URL from the note and check it answers HTTP 200 with no Location and no X-Robots-Tag: noindex, look for a robots meta tag in its source, then re-run the audit.",
    "related": [
      "indexing-canonical-mismatch",
      "indexing-sitemap-hygiene",
      "indexing-noindex"
    ]
  },
  "indexing-canonical-multiple": {
    "summary": "A page declares more than one <link rel=\"canonical\"> tag. When their URLs differ, Google is likely to ignore all of them and choose the canonical itself. Two tags with the same URL still mean two parts of the code write the canonical, and they can drift apart.",
    "failing": {
      "label": "Head of a page with two canonicals",
      "lang": "html",
      "code": "<head>\n  <link rel=\"canonical\" href=\"https://example.com/shoes\">\n  <!-- added by an SEO plugin -->\n  <link rel=\"canonical\" href=\"https://example.com/shoes?ref=nav\">\n</head>"
    },
    "measured": "Septune counts the <link> tags whose rel is canonical in the <head> of every page that answers 2xx, noindexed pages included. It reads the HTML it stored for the page, which is the first 60,000 characters, and stops at </head>. A page is reported when it has two or more such tags. The note gives the count and up to 3 distinct URLs, or says the same URL is repeated.",
    "consequence": "With different URLs in the tags, the page loses its canonical hint, and a parameter or tracking variant can be indexed instead of the clean URL.",
    "fix": "Keep exactly one canonical per page. A second one usually comes from a shared layout that sets its own next to the page's, or from a plugin. Remove it at the source rather than overriding it in the page.",
    "frameworks": {
      "nextjs": "The Metadata API prints one canonical, because a page's alternates replaces the layout's; a second tag comes from a hand-written <link rel=\"canonical\"> in a layout or from a package such as next-seo, so remove that and keep alternates.canonical.",
      "astro": "Render the canonical in one layout component and pass the URL down as a prop; nested layouts that each write one produce two tags.",
      "sveltekit": "<svelte:head> blocks add up instead of replacing each other, so a canonical in +layout.svelte and another in +page.svelte both render; keep one."
    },
    "verify": "View the page source (or run curl -s https://example.com/page | grep -io '<link[^>]*canonical[^>]*>') and check there is exactly one match, then re-run the audit.",
    "related": [
      "indexing-canonical-missing",
      "indexing-canonical-mismatch",
      "indexing-canonical-target-invalid"
    ]
  },
  "indexing-meta-refresh": {
    "summary": "The page carries <meta http-equiv=\"refresh\">, so the browser reloads it or sends the visitor elsewhere once the HTML has loaded. The server answers 200, so anything that reads status codes sees an ordinary page where a redirect was meant.",
    "failing": {
      "label": "Old URL that forwards with a meta refresh",
      "lang": "html",
      "code": "<!-- HTTP/1.1 200 OK for https://example.com/old-pricing -->\n<head>\n  <meta http-equiv=\"refresh\" content=\"0; url=https://example.com/pricing\">\n  <title>Redirecting</title>\n</head>"
    },
    "measured": "Septune looks for a <meta> tag with http-equiv=\"refresh\" (quotes optional) in the <head> of each 2xx page, within the first 60,000 characters of HTML it keeps and before </head>. Any refresh counts: an instant redirect, a delayed one, and a timed reload of the same page with no URL. The note shows the tag's content value, such as 0; url=/pricing. Every affected page is listed.",
    "consequence": "Google documents that it treats an instant meta refresh as a permanent redirect and a delayed one as a temporary redirect, and recommends server-side redirects when you can use them. Link checkers and log analysis record the old URL as a working 200 page.",
    "fix": "Replace the tag with a server redirect: 301 or 308 for a page that moved for good, 302 or 307 if it will come back. Declare it in your framework's redirects config or at the host, then delete the page that only existed to carry the refresh. For a page that reloads itself to show fresh data, fetch the data from JavaScript instead of reloading the document.",
    "frameworks": {
      "nextjs": "Add the move to redirects() in next.config with permanent: true (308); with output: \"export\" Next.js serves no redirects, so declare them at the host.",
      "nuxt": "Use a redirect route rule in nuxt.config.ts with an explicit 301 status, or navigateTo(path, { redirectCode: 301 }) in route middleware.",
      "astro": "Without an adapter, Astro builds config redirects and Astro.redirect on static routes as meta refresh pages; add your host's adapter, or declare the redirects in the host's own config.",
      "sveltekit": "Call redirect(308, '/new') from @sveltejs/kit in the route's load function or in hooks.server.ts, on an adapter that runs a server."
    },
    "verify": "Run curl -sI https://example.com/old-pricing and check the status line is 301 or 308 with a Location header instead of 200, then re-run the audit.",
    "related": [
      "indexing-temporary-redirect",
      "indexing-redirect-chain",
      "indexing-canonical-target-invalid"
    ]
  },
  "indexing-hreflang-invalid": {
    "summary": "The page's hreflang annotations break Google's rules: a code that isn't a valid language or region, a relative URL, no entry for the page itself, no return link from the alternate, or an alternate that errors, redirects or is noindex. Google discards annotations it can't use, so searchers can land on the wrong language version.",
    "failing": {
      "label": "hreflang set with three faults",
      "lang": "html",
      "code": "<!-- https://example.com/en/pricing -->\n<head>\n  <link rel=\"alternate\" hreflang=\"en_GB\" href=\"https://example.com/en/pricing\">\n  <link rel=\"alternate\" hreflang=\"fr\" href=\"/fr/tarifs\">\n  <link rel=\"alternate\" hreflang=\"jp\" href=\"https://example.com/ja/pricing\">\n</head>\n<!-- /fr/tarifs has no hreflang link back to /en/pricing -->"
    },
    "measured": "Septune reads the <link rel=\"alternate\"> tags that have both an hreflang and an href in the <head> of each 2xx page; hreflang sent in HTTP Link headers or in the sitemap is not read. Every code must be x-default or an ISO 639-1 language, with an optional 4-letter script and an optional ISO 3166-1 alpha-2 region, and the note names common slips: an underscore, a country used as a language, UK instead of GB, a numeric region such as 419. Every href must be absolute, the page must list itself, and one code must not point at two URLs. Each alternate the crawl fetched must answer below 400, not redirect, not be noindex, and link back to the page; alternates it didn't fetch are counted as unchecked in the evidence. The note keeps the first 4 problems per page and counts the rest.",
    "consequence": "Google drops annotations it can't pair or parse, so the English page can be shown to French searchers, or an alternate is never offered at all.",
    "fix": "Build every page's tags from one list of locale and URL pairs, so all versions print the same set: one tag per version, the page's own included, absolute URLs, and x-default for a fallback page if you have one. Point each tag at the final URL of the alternate, never at an address that redirects. Write codes as language-REGION with a hyphen, for example en-GB or pt-BR.",
    "frameworks": {
      "nextjs": "Set alternates.languages in generateMetadata, the page's own locale included, with metadataBase defined so Next.js prints absolute href values.",
      "astro": "With i18n routing, build the tags in the layout from your locales list with getAbsoluteLocaleUrl from astro:i18n, which returns absolute URLs."
    },
    "verify": "Run curl -s https://example.com/en/pricing | grep -io '<link[^>]*hreflang[^>]*>' on each language version and check they all print the same set of absolute URLs, their own included, then re-run the audit.",
    "related": [
      "indexing-html-lang-missing",
      "indexing-canonical-target-invalid",
      "indexing-sitemap-hygiene"
    ]
  },
  "indexing-duplicate-content": {
    "summary": "Two or more pages carry nearly the same visible text. Google groups duplicates and usually shows one URL per group, which may not be the one you would pick, and the others bring little search traffic of their own.",
    "failing": {
      "label": "Visible text of two city pages built from one template",
      "lang": "text",
      "code": "/locations/lyon\n  Fast repairs for every phone brand. Same-day service, 6-month warranty,\n  free diagnosis. Book online or walk in. Open Monday to Saturday.\n  Our team in Lyon is ready to help.\n\n/locations/grenoble\n  Fast repairs for every phone brand. Same-day service, 6-month warranty,\n  free diagnosis. Book online or walk in. Open Monday to Saturday.\n  Our team in Grenoble is ready to help."
    },
    "measured": "Septune compares the visible body text of every 2xx page without noindex in a robots or googlebot meta tag. Scripts, styles, noscript and template blocks are removed, navigation and footer text stay in, and only the first 12,000 characters are used. The text is lowercased, every character outside a-z and 0-9 becomes a space, and the words are cut into overlapping 8-word shingles. A page joins a cluster when the Jaccard similarity of its shingles with the cluster's first page is 0.72 or more; a page with fewer than 8 words is compared as one block. Canonical tags are not taken into account. Every page of each cluster is listed with the cluster's average similarity.",
    "consequence": "Pages in a cluster compete for the same queries, and Google filters all but one out of most results.",
    "fix": "Give each page text only it can carry: for city or product variants, the address, opening hours, local photos, real specifications. If two pages serve the same intent, merge them and redirect the weaker URL with a 301. A canonical tells Google which one to show, but Septune compares text, so a canonicalised pair stays in this list; a noindex robots meta tag on the copy takes it out.",
    "verify": "Open the two listed pages side by side, or diff their visible text, to see which blocks they share; after rewriting or merging, re-run the audit.",
    "related": [
      "structure-thin-content",
      "indexing-canonical-missing",
      "meta-title-duplicate"
    ]
  },
  "indexing-redirect-chain": {
    "summary": "A link on your site leads to a URL that redirects two or more times before it reaches a page. Each hop is a separate request, so visitors wait longer and crawlers spend fetches on addresses that only forward.",
    "failing": {
      "label": "Link target answering with two redirects",
      "lang": "http",
      "code": "HEAD https://example.com/blog/old-post\nHTTP/1.1 301 Moved Permanently\nLocation: http://example.com/blog/new-post\n\nHEAD http://example.com/blog/new-post\nHTTP/1.1 301 Moved Permanently\nLocation: https://www.example.com/blog/new-post\n\nHEAD https://www.example.com/blog/new-post\nHTTP/1.1 200 OK"
    },
    "measured": "After the crawl, Septune requests the links found on 2xx pages: external links, plus internal links whose path isn't the final URL of a page already crawled. It takes up to 64 distinct URLs per audit, in crawl order (16 on the free web audit). Each one is requested with HEAD, or with a one-byte ranged GET when HEAD fails or answers 405 or 501, and redirects are followed by hand, up to 5, inside a single 7-second budget per link. A link is reported when it went through 2 or more redirects; the note gives the hop count and the URL it ended on. Up to 40 links are listed, and the URL shown is the link target, not the page holding the link.",
    "consequence": "Every click on the link pays for each extra round trip, and Googlebot fetches each intermediate URL before it gets to the content.",
    "fix": "Change the href to the final URL from the note, so the link needs no redirect at all. Then collapse the chain where it starts: each old URL should redirect straight to the final one in a single 301 or 308, instead of passing through a slug rule, then an https rule, then a www rule.",
    "verify": "Run curl -sIL https://example.com/blog/old-post | grep -iE '^(HTTP|location)' and count the Location lines; once the href is updated the link itself should answer 200. Then re-run the audit.",
    "related": [
      "indexing-temporary-redirect",
      "indexing-http-not-redirected",
      "link-broken-external"
    ]
  },
  "indexing-temporary-redirect": {
    "summary": "An internal link lands on a 302 or 307, status codes that announce a temporary move. For a page that moved for good, Google keeps treating the old URL as the main one, so the new address may not replace it in results.",
    "failing": {
      "label": "Internal link answering with a 307",
      "lang": "http",
      "code": "HEAD https://example.com/pricing-2025\nHTTP/1.1 307 Temporary Redirect\nLocation: /pricing\n\nHEAD https://example.com/pricing\nHTTP/1.1 200 OK"
    },
    "measured": "Septune reuses the link probe of the redirect-chain check: links on 2xx pages that weren't crawled themselves, up to 64 per audit (16 on the free web audit), each followed through at most 5 redirects. It keeps links on your own host, ignoring www. and including http:// links, where any hop answered 302 or 307; 301, 303 and 308 are not counted. Links whose final URL has a path segment such as login, account, dashboard, cart, checkout or search are left out, because sending a signed-out visitor to a sign-in page is a correct temporary redirect. The note lists the hop statuses and the final path, and up to 40 links are listed.",
    "consequence": "Google documents a permanent redirect as a strong signal that the target should be canonical and a temporary one as a weak signal, so after a 302 or 307 the old URL can stay in results long after the move.",
    "fix": "If the page moved for good, change the redirect to 301 or 308, and update the link to the final URL so it skips the redirect entirely. Keep 302 or 307 for moves you will undo: a sign-in wall, a maintenance page, a short campaign.",
    "frameworks": {
      "nextjs": "redirect() from next/navigation sends 307; use permanentRedirect(), or permanent: true in next.config redirects(), to send 308.",
      "nuxt": "navigateTo() answers 302 on the server unless you pass { redirectCode: 301 }; give redirect route rules in nuxt.config.ts an explicit 301 status too.",
      "astro": "Astro.redirect() answers 302 on on-demand routes unless you pass 301 as its second argument; redirects in astro.config.mjs default to 301.",
      "sveltekit": "redirect() from @sveltejs/kit takes the status as its first argument: pass 308 or 301 for pages that moved."
    },
    "verify": "Run curl -sI on the link from the note and check the first status line reads 301 or 308, or that the updated link answers 200 directly, then re-run the audit.",
    "related": [
      "indexing-redirect-chain",
      "indexing-meta-refresh",
      "indexing-http-not-redirected"
    ]
  },
  "indexing-html-lang-missing": {
    "summary": "The page's <html> element has no lang attribute. Screen readers use it to pick a pronunciation, and browsers use it for translation prompts and hyphenation. Google says it detects a page's language from the visible text and ignores lang, so this is mainly an accessibility and browser issue.",
    "failing": {
      "label": "French page with a bare <html> element",
      "lang": "html",
      "code": "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\">\n    <title>Horaires et tarifs | Example</title>\n  </head>\n  <body>...</body>\n</html>"
    },
    "measured": "Septune reads the first <html> tag of every 2xx page, noindexed ones included, and looks for a lang attribute with a quoted value. The page is reported when there is none or the value is empty; an unquoted lang=fr is not recognised. The value is not validated against language codes. Every page without it is listed.",
    "consequence": "Assistive technology reads the page with the user's default voice, so French text can be spoken with English pronunciation. WCAG 2 success criterion 3.1.1 (Language of Page, level A) asks for the page language to be declared, and lang on <html> is how HTML declares it.",
    "fix": "Set lang on the root <html> element to the page's main language, as a BCP 47 tag such as en, fr or pt-BR. On a multilingual site, set it per page from the route's locale instead of once for the whole site.",
    "frameworks": {
      "nextjs": "Write it on the <html> element in app/layout.tsx; with a [lang] segment, render <html lang={lang}> in app/[lang]/layout.tsx from the route params.",
      "nuxt": "Set app.head.htmlAttrs.lang in nuxt.config.ts, or call useHead({ htmlAttrs: { lang } }) when it depends on the route.",
      "astro": "Write it on <html> in the layout; with i18n routing, use Astro.currentLocale as the value.",
      "sveltekit": "The <html> element lives in src/app.html: set lang there, or write a placeholder such as lang=\"%lang%\" and replace it in the handle hook of hooks.server.ts with transformPageChunk."
    },
    "verify": "Run curl -s https://example.com/ | grep -io '<html[^>]*>' and check the printed tag carries lang with the right code, then re-run the audit.",
    "related": [
      "indexing-hreflang-invalid",
      "perf-viewport-missing"
    ]
  },
  "indexing-sitemap-hygiene": {
    "summary": "Your sitemap lists URLs that shouldn't be indexed as they stand: they error, redirect, carry noindex, canonicalise to another URL, sit on another host or aren't absolute. Search engines read a sitemap as your list of preferred URLs, and each of these entries contradicts what the page itself says.",
    "failing": {
      "label": "Sitemap with four entries that don't belong",
      "lang": "xml",
      "code": "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url><loc>https://example.com/</loc></url>\n  <url><loc>https://example.com/old-pricing</loc></url> <!-- 301 to /pricing -->\n  <url><loc>https://example.com/cart</loc></url> <!-- noindex -->\n  <url><loc>http://localhost:3000/blog</loc></url> <!-- wrong host -->\n  <url><loc>/about</loc></url> <!-- relative -->\n</urlset>"
    },
    "measured": "Septune reads the sitemaps named by Sitemap: lines in robots.txt, or /sitemap.xml, /sitemap_index.xml and /sitemap-index.xml in turn when none is declared, follows sitemap indexes and gzip files, and keeps up to 5,000 URLs from up to 10 files (300 URLs from 2 files on the free web audit). Each listed URL that isn't absolute, or whose origin differs from the one the site's start page landed on, is reported. Each listed URL the crawl fetched is then checked for a status of 400 or above, a redirect, a noindex (meta tag or X-Robots-Tag header) or a canonical pointing to another URL. Entries are matched on scheme, host and path, ignoring a trailing slash and the query string, and entries the crawl didn't reach are not judged. The evidence says how many listed URLs were checked, and names the other host when entries point there.",
    "consequence": "Crawlers sent through the sitemap hit redirects, errors and noindex pages, and entries on a wrong host point them away from your site.",
    "fix": "Generate the sitemap from the same source as your routes, filtered to pages that answer 200, are indexable and are their own canonical. Write each <loc> as an absolute URL on your production origin, taken from one setting, and replace moved URLs with their final address. Rebuild it on every deploy so removed pages drop out.",
    "frameworks": {
      "nextjs": "In app/sitemap.ts, build each url from one production origin constant rather than a preview or localhost variable, and leave out routes whose metadata sets noindex or a canonical elsewhere.",
      "nuxt": "With @nuxtjs/sitemap, set site.url in nuxt.config.ts to the production origin so entries aren't written for another host.",
      "astro": "@astrojs/sitemap writes URLs from site in astro.config.mjs; set it to the production origin and drop noindex or redirecting pages with the filter option."
    },
    "verify": "Fetch the sitemap with curl -s https://example.com/sitemap.xml, then run curl -sI on the entries from the note: each should answer 200 on your own origin with no Location header. Then re-run the audit.",
    "related": [
      "indexing-sitemap-gaps",
      "indexing-sitemap-format",
      "indexing-canonical-target-invalid"
    ]
  },
  "indexing-sitemap-gaps": {
    "summary": "A page that can be indexed was reached through links but isn't in your sitemap. Search engines can still find it by crawling, though only through those links, and the sitemap no longer lists everything you want indexed.",
    "failing": {
      "label": "Sitemap missing a linked blog post",
      "lang": "xml",
      "code": "<!-- crawled from a link on /blog: https://example.com/blog/pricing-guide (200, indexable) -->\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url><loc>https://example.com/</loc></url>\n  <url><loc>https://example.com/blog</loc></url>\n  <url><loc>https://example.com/pricing</loc></url>\n</urlset>"
    },
    "measured": "This check runs only when the sitemaps listed at least one URL and the scan finished without hitting a cap on files, URLs, bytes or time, since a cut-off list can't show what's missing. Septune then takes each crawled page that answers 2xx, has no noindex in a meta tag or X-Robots-Tag header, and has no canonical pointing elsewhere, and reports it when the sitemap doesn't list it. Matching uses scheme, host and path, ignoring a trailing slash and the query string. Pages the crawl reached from the sitemap are skipped, and only crawled pages are compared, so a higher page limit can surface more gaps.",
    "consequence": "New pages and updates to these pages aren't announced through the sitemap, so search engines notice them only when they next follow a link there.",
    "fix": "Build the sitemap from the full list of indexable routes, pages from a CMS or a database included, and regenerate it when content is published. If a reported page shouldn't be indexed, give it a noindex or a canonical to the right URL, and it leaves this check.",
    "frameworks": {
      "nextjs": "app/sitemap.ts can be async: fetch the same CMS or database list your dynamic routes render, so new posts appear without a code change.",
      "nuxt": "@nuxtjs/sitemap doesn't discover dynamic routes by itself; feed them through its sources option from an API endpoint.",
      "astro": "@astrojs/sitemap only knows pages generated at build time; add on-demand pages through its customPages option.",
      "sveltekit": "A hand-written src/routes/sitemap.xml/+server.ts has to query the same data your [slug] routes render."
    },
    "verify": "Search the sitemap (or the child sitemap that should hold the page) for a reported path, for example curl -s https://example.com/sitemap.xml | grep -c '/blog/pricing-guide', and check it prints 1, then re-run the audit.",
    "related": [
      "indexing-sitemap-hygiene",
      "link-orphan-pages",
      "framework-sitemap-missing"
    ]
  },
  "indexing-sitemap-format": {
    "summary": "A sitemap that robots.txt declares, or that an index lists, couldn't be read: it failed to download, answered with an error, came back as an HTML page, or has no <urlset> or <sitemapindex> root. Search engines skip a file they can't parse, so the URLs it holds never reach them through it.",
    "failing": {
      "label": "Sitemap path answered by a single-page app shell",
      "lang": "http",
      "code": "GET https://example.com/sitemap.xml\nHTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\n\n<!doctype html><html><head><title>Example</title>"
    },
    "measured": "Septune fetches the files named by Sitemap: lines in robots.txt (or the three usual paths, tried in turn, when none is declared) and every child file an index lists, stopping once 10 files have been read (2 on the free web audit). A file counts as unreadable when the request fails or times out, the status isn't 2xx, the Content-Type is text/html even if the body is XML, a gzip body can't be inflated, or the content has neither <urlset> nor <sitemapindex> and no <loc> entries. The rule fires only when robots.txt declares a file or at least one was read; a site with no sitemap at all is reported by framework-sitemap-missing. The evidence names the first 3 files with their reason, and up to 20 files are listed.",
    "consequence": "Every URL that only this file lists is missing from what your sitemaps tell search engines, and if you submitted the file, Search Console reports it as an error.",
    "fix": "Serve each sitemap with a 200 status and an XML Content-Type such as application/xml, with <urlset> as the root of a URL list and <sitemapindex> as the root of an index. Make robots.txt and the index point at paths that exist. The HTML case usually comes from a single-page app's catch-all route answering /sitemap.xml with index.html.",
    "frameworks": {
      "nextjs": "app/sitemap.ts serves /sitemap.xml with an XML Content-Type; if robots.txt names another path, fix the sitemap field in app/robots.ts.",
      "nuxt": "Add @nuxtjs/sitemap, or a server route in server/routes/sitemap.xml.ts that sets an XML Content-Type.",
      "astro": "@astrojs/sitemap writes sitemap-index.xml and sitemap-0.xml, not sitemap.xml, so a robots.txt line pointing at /sitemap.xml gets a 404; point it at /sitemap-index.xml.",
      "sveltekit": "Return the XML from src/routes/sitemap.xml/+server.ts with a Content-Type of application/xml, and add export const prerender = true when using adapter-static."
    },
    "verify": "Run curl -sI https://example.com/sitemap.xml and check for a 200 status and an XML Content-Type, then curl -s https://example.com/sitemap.xml | head -c 300 should show a <urlset or <sitemapindex root. Then re-run the audit.",
    "related": [
      "framework-sitemap-missing",
      "framework-robots-no-sitemap",
      "indexing-sitemap-hygiene"
    ]
  },
  "indexing-https-certificate": {
    "summary": "The TLS certificate of the audited host has expired, isn't trusted, or expires within 14 days. An expired or untrusted certificate puts a full-page security warning in front of the site; one this close to its end date suggests automatic renewal has stopped working.",
    "failing": {
      "label": "Certificate with nine days left",
      "lang": "text",
      "code": "$ echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -issuer -enddate\nissuer=C = US, O = Let's Encrypt, CN = R11\nnotAfter=Nov  8 12:00:00 2026 GMT"
    },
    "measured": "For an https:// start URL, Septune makes one TLS handshake with its host and port (443 by default), sending the hostname as SNI, with a 6-second timeout (3.5 seconds in the free web audit); no HTTP request is sent. It reads the expiry date and issuer, and asks Node.js whether the chain is trusted and the certificate matches the hostname. It reports an expired certificate (critical), an untrusted or mismatched one (critical), or one with 14 days or fewer left (high). A handshake that fails or times out gives no data and no finding.",
    "consequence": "With an expired or untrusted certificate, browsers stop visitors at a warning page, and clients that verify certificates, crawlers included, can fail to fetch the site. A certificate near expiry works today and fails on its end date unless it is renewed first.",
    "fix": "Renew or reissue the certificate where it is managed: the host, the CDN, or a certbot job on the server. If renewal is automatic, find why it failed, for example a DNS record now pointing elsewhere, a blocked /.well-known/acme-challenge/ path, or a CAA record that excludes the issuer. For a hostname mismatch, make sure the certificate covers both example.com and www.example.com. A note reading UNABLE_TO_VERIFY_LEAF_SIGNATURE usually means the server sends its certificate without the intermediate chain.",
    "verify": "Run echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -checkend 1209600, which says whether the certificate is still valid 14 days from now; s_client run on its own ends with Verify return code: 0 (ok) when the chain is trusted. Check the www host too, then re-run the audit.",
    "related": [
      "indexing-http-not-redirected",
      "indexing-host-duplicate",
      "perf-mixed-content"
    ]
  },
  "indexing-host-duplicate": {
    "summary": "The homepage answers 2xx on both example.com and www.example.com, and the spare spelling neither redirects to the site's address nor names it as canonical. Search engines can then index the same pages under two hostnames.",
    "failing": {
      "label": "Both spellings answering 200",
      "lang": "http",
      "code": "GET / HTTP/1.1\nHost: example.com\n\nHTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\n\nGET / HTTP/1.1\nHost: www.example.com\n\nHTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8"
    },
    "measured": "Septune takes the start URL's hostname, adds or removes the www. prefix, and requests / on that spelling with the same scheme and port, following redirects with a 6-second timeout. IP addresses and hostnames without a dot are skipped. It reports the spelling when the final status is 2xx, the final hostname differs from the one the start page landed on, and the HTML (first 64,000 characters) has no canonical link whose host is the site's host. Only the homepage is checked, and a spelling that errors or doesn't resolve is ignored.",
    "consequence": "Google has to work out which hostname to show for each page, and signals such as links can stay split between the two copies. Reports and analytics are split the same way.",
    "fix": "Redirect every path on the spare hostname to the same path on the real one with a 301 or 308, in the host's or CDN's domain settings. Redirecting only the homepage leaves the inner pages duplicated. A canonical tag pointing at the real host is the weaker fallback when a redirect isn't possible.",
    "verify": "Run curl -sI https://www.example.com/some/page (using the spelling Septune listed) and expect a 301 or 308 whose Location is on the real host with the same path. Then re-run the audit.",
    "related": [
      "indexing-http-not-redirected",
      "indexing-canonical-missing",
      "indexing-duplicate-content"
    ]
  },
  "indexing-http-not-redirected": {
    "summary": "The site runs on https://, but its homepage over plain http:// returns a 2xx page instead of a redirect. People who type the bare address get an unencrypted page, and search engines see a second copy of the site.",
    "failing": {
      "label": "The http:// homepage served as a normal page",
      "lang": "text",
      "code": "$ curl -sI http://example.com/\nHTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\nServer: nginx\n\n$ curl -sI https://example.com/\nHTTP/2 200\ncontent-type: text/html; charset=utf-8"
    },
    "measured": "Only when the start URL is https://, Septune requests http:// on the same host, path /, following redirects with a 6-second timeout. It reports it when the final status is 2xx, the final URL is still http://, and the page has no canonical link on the site's host. The canonical's scheme isn't compared, so a relative canonical, or one pointing at the http:// address, also clears the finding. Only the homepage is checked.",
    "consequence": "Visitors on the http:// address exchange everything unencrypted, and Google can index both versions. Google prefers the HTTPS page as canonical when both exist, but a redirect removes the choice instead of relying on it.",
    "fix": "Turn on the host's force-HTTPS option, or add a permanent redirect (301 or 308) from every http:// URL to the same path on https:// at the server or CDN. Once that works, consider a Strict-Transport-Security (HSTS) header so browsers go straight to https:// on later visits.",
    "verify": "Run curl -sI http://example.com/ and expect a 301 or 308 with Location: https://example.com/, then try an inner path such as http://example.com/about to confirm the redirect keeps the path. Then re-run the audit.",
    "related": [
      "indexing-host-duplicate",
      "indexing-https-certificate",
      "perf-mixed-content"
    ]
  },
  "structure-h1-missing": {
    "summary": "The page has no <h1> with text in its HTML. Nothing in the content marks the page's main subject as its top heading.",
    "failing": {
      "label": "Page title styled as a heading but marked up as a div",
      "lang": "html",
      "code": "<body>\n  <header>\n    <a href=\"/\"><img src=\"/logo.svg\" alt=\"Example Store\"></a>\n  </header>\n  <main>\n    <div class=\"page-title\">Trail shoes</div>\n    <h2>Waterproof models</h2>\n    <p>Six models with a waterproof membrane.</p>\n  </main>\n</body>"
    },
    "measured": "Septune finds every <h1> element in the served HTML of each 2xx page without a noindex meta tag and strips the tags inside it. A heading left without text, for example one that wraps only an <img> or an <svg>, doesn't count, and neither does a <div> styled to look like a heading. Pages with no counted H1 are listed. JavaScript isn't run, so an H1 rendered on the client is missed.",
    "consequence": "Screen-reader users who jump to the first heading don't land on the page's subject. Google lists heading elements among the sources it uses to write title links, so the page also gives it one hint fewer.",
    "fix": "Mark up the visible page title as an <h1>, near the start of the main content. If the only H1 is a logo image, give the page its own text H1 and keep the logo as a link outside it. If the H1 appears only in the browser, render it on the server.",
    "verify": "Run curl -s https://example.com/page | grep -io '<h1[^>]*>.*</h1>' and check it prints a heading with text (DevTools shows the DOM after JavaScript, so it can hide this problem), then re-run the audit.",
    "related": [
      "structure-h1-multiple",
      "structure-heading-skip",
      "meta-title-missing"
    ]
  },
  "structure-h1-multiple": {
    "summary": "The page has more than one <h1>. Readers and assistive technology lose the single heading that names the page, and the structure under it is harder to follow.",
    "failing": {
      "label": "A site name, a page title and a section all using <h1>",
      "lang": "html",
      "code": "<header>\n  <h1><a href=\"/\">Example Store</a></h1>\n</header>\n<main>\n  <h1>Trail shoes</h1>\n  <section>\n    <h1>Waterproof models</h1>\n    <p>Six models with a waterproof membrane.</p>\n  </section>\n</main>"
    },
    "measured": "Septune counts the <h1> elements that contain text anywhere in the served HTML of each 2xx page without a noindex meta tag, including ones hidden with CSS and ones in a header, footer, menu or dialog. Pages with two or more are listed with the count as the note. An <h1> that holds only an image isn't counted.",
    "consequence": "Screen-reader users listing the headings meet several top-level ones and have to guess which names the page. When the extra H1 is a site name in the shared header, every page starts with the same top heading.",
    "fix": "Keep one H1 for the page's own subject and demote the others to <h2> or lower. The usual sources are a site name wrapped in <h1> in the shared header, a section component that always renders an <h1>, and a hidden mobile menu or modal with its own. Change the tag and keep the look with a class.",
    "verify": "Count them in the served HTML with curl -s https://example.com/page | grep -oi '<h1[ >]' | wc -l, which should print 1, then re-run the audit.",
    "related": [
      "meta-title-missing",
      "structure-h1-missing",
      "structure-heading-skip",
      "content-keyword-alignment"
    ]
  },
  "structure-heading-skip": {
    "summary": "A heading is two or more levels deeper than the one before it, such as an <h2> followed directly by an <h4>. The outline has a gap, which confuses people who move through the page by headings.",
    "failing": {
      "label": "Two skips in one page",
      "lang": "html",
      "code": "<h1>Trail shoes</h1>\n<h3>Waterproof models</h3>  <!-- h1 to h3, no h2 -->\n<p>Six models with a waterproof membrane.</p>\n<h2>Sizing</h2>\n<h4>Wide feet</h4>          <!-- h2 to h4, no h3 -->\n<p>Order half a size up.</p>"
    },
    "measured": "Septune walks through the first 60 headings that contain text, in source order, on each 2xx page without a noindex meta tag. It reports the page when a heading is at least two levels deeper than the previous one. Going back up, from <h4> to <h2>, is allowed, and the level of the first heading isn't checked, so a page that starts at <h2> passes. The list names the pages, not where the skip is.",
    "consequence": "Screen-reader users who navigate by heading level find a gap and may think a section is missing. The W3C's headings tutorial asks authors to avoid skipping ranks, and accessibility checkers such as axe report it under the heading-order rule.",
    "fix": "Choose heading tags by their place in the outline and set their size with classes. A skip usually comes from picking <h4> because it looks right, or from a reusable card or widget with a fixed heading level placed under a different parent; let such components take the level as a prop.",
    "verify": "In the DevTools console, run [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName).join(' ') and check that no step goes deeper by more than one level, then re-run the audit.",
    "related": [
      "structure-h1-missing",
      "structure-h1-multiple"
    ]
  },
  "structure-thin-content": {
    "summary": "The page has fewer than 120 words of visible text in its HTML. Either there is little on it, or its content is loaded by JavaScript and missing from what the server sends.",
    "failing": {
      "label": "Product grid rendered only in the browser",
      "lang": "html",
      "code": "<body>\n  <nav><a href=\"/\">Home</a> <a href=\"/shoes\">Shoes</a> <a href=\"/contact\">Contact</a></nav>\n  <main>\n    <h1>Trail shoes</h1>\n    <!-- the product grid is rendered here by JavaScript -->\n    <div id=\"app\"></div>\n  </main>\n  <footer>Example Store, 12 Harbour Road</footer>\n</body>"
    },
    "measured": "Septune counts the words of visible text in the <body> of each 2xx page without a noindex meta tag: script, style, noscript and template blocks are removed, tags are stripped, and the rest is split on whitespace. Navigation, header and footer text count, so a page can reach 120 with almost no main content. Pages under 120 words are listed with their count. The count comes from the HTML as served, before any JavaScript runs.",
    "consequence": "With so little text, there is not much for a search engine to match to a query or quote in an answer. When the content arrives through JavaScript, crawlers that don't run scripts see the page as nearly empty.",
    "fix": "Decide page by page. Expand it with what a visitor needs there (specs, steps, prices, answers to the questions they ask), merge it into a stronger page and redirect the old URL, or add a noindex robots meta tag if it only exists for navigation. If the text shows in the browser but not in the count, render it on the server or prerender the route.",
    "frameworks": {
      "nextjs": "Fetch the data in a Server Component instead of a client component's useEffect, so the text is in the HTML response.",
      "nuxt": "Load the data with useFetch or useAsyncData during setup, and check that routeRules don't set ssr: false for the route.",
      "astro": "Render the content in the .astro component or in a hydrated island, not in a client:only one, which sends no server HTML for it.",
      "sveltekit": "Load the data in a +page.server.js or +page.js load function rather than in onMount, and don't set export const ssr = false on the route."
    },
    "verify": "Open view-source:https://example.com/page and check the main text is present in the <body> markup, not only in the rendered page, then re-run the audit.",
    "related": [
      "indexing-soft-404",
      "indexing-duplicate-content"
    ]
  },
  "structure-url-format": {
    "summary": "The page's URL has an underscore in its path, more than two query parameters, or more than 200 characters. Such URLs are harder to read in a result or a message, and parameters can multiply the URLs that lead to the same content.",
    "failing": {
      "label": "One URL per reason Septune reports",
      "lang": "text",
      "code": "https://example.com/Trail_Shoes/Waterproof_Models\nhttps://example.com/shoes?color=black&size=42&sort=price\nhttps://example.com/blog/how-to-choose-waterproof-trail-running-shoes-for-wet-muddy-and-rocky-terrain-with-sizing-advice-and-a-comparison-of-membranes-outsoles-and-lacing-systems-for-every-season-of-the-year"
    },
    "measured": "Septune checks the URL each page was fetched at, after redirects, for crawled pages that answer 2xx, carry no noindex (meta tag or X-Robots-Tag header) and don't declare a canonical on a different path or host. It reports an underscore in the path (the host and the query string aren't checked), more than 2 query parameters (each key counts, repeated ones too), or a full URL over 200 characters. The note gives each reason, the list shows paths, and at most 40 pages are listed. Septune identifies a page by its path and audits it at the first URL it reached for that path, so the parameters checked are the ones on that link.",
    "consequence": "Google's URL structure guidelines recommend hyphens rather than underscores to separate words, and warn that URLs with many parameters can create large numbers of URLs pointing to identical or similar content, which crawlers then spend time on. Very long URLs are hard to read and to share.",
    "fix": "Change existing URLs only when it's worth it: each change needs a permanent redirect (301 or 308) from the old URL, plus updated internal links and sitemap entries. For new pages, use lowercase words joined by hyphens. For filter, sort and tracking parameters, link to the clean URL in your own navigation and keep a canonical to it on the variants; the entry goes away once internal links reach the page without them.",
    "frameworks": {
      "nextjs": "Add the old path to redirects() in next.config with permanent: true, which answers 308.",
      "nuxt": "Declare routeRules: { '/Trail_Shoes': { redirect: { to: '/trail-shoes', statusCode: 301 } } } in nuxt.config.ts.",
      "astro": "List the move in the redirects option of astro.config.mjs, but with static output and no adapter Astro writes a meta refresh page instead of a 301, so set the redirect at your host in that case.",
      "sveltekit": "In the old route's +page.server.js load function, use redirect(301, '/trail-shoes') from @sveltejs/kit."
    },
    "verify": "Run curl -sI https://example.com/Trail_Shoes and check it answers 301 or 308 with a Location header on the new URL, and that the new URL answers 200, then re-run the audit.",
    "related": [
      "indexing-temporary-redirect",
      "indexing-redirect-chain",
      "indexing-canonical-missing"
    ]
  },
  "content-readability": {
    "summary": "The page's text scores under 20 on the Flesch Reading Ease scale, which means long sentences built from long words. Readers have to work through it to get the point.",
    "failing": {
      "label": "A paragraph that scores far below 20",
      "lang": "html",
      "code": "<article>\n  <p>Notwithstanding the aforementioned considerations, organizational\n  implementation of interoperability infrastructure necessitates\n  comprehensive evaluation of heterogeneous authentication methodologies,\n  particularly where regulatory documentation requirements\n  institutionalize retrospective accountability mechanisms.</p>\n  <!-- 300 more words in the same register -->\n</article>"
    },
    "measured": "On each 2xx page without a noindex meta tag and with at least 200 words, Septune computes the Flesch Reading Ease of the first 12,000 characters of visible text: 206.835 - 1.015 × (words per sentence) - 84.6 × (syllables per word), rounded. A sentence ends at each run of ., ! or ?, but the count never falls below one sentence per 25 words, so lists and menus without punctuation don't sink the score. Syllables are estimated from vowel groups, which only suits English. Pages scoring under 20 are listed with their score, up to 40.",
    "consequence": "On the usual Flesch scale, scores from 0 to 30 are labelled very difficult, best understood by university graduates. Because the floor on sentence count limits what long sentences can cost, a page this low is mostly made of long words with many syllables.",
    "fix": "Split sentences that carry more than one idea, turn nouns built from verbs back into verbs (\"the implementation of\" becomes \"implementing\"), and swap long general words for short exact ones. Keep the technical terms your readers search for and simplify the words around them. Turn enumerations into lists.",
    "verify": "Paste the main text into a Flesch Reading Ease calculator and check the score is now above 20, then re-run the audit.",
    "related": [
      "content-keyword-alignment",
      "content-keyword-stuffing"
    ]
  },
  "content-keyword-stuffing": {
    "summary": "A single word accounts for more than 6% of the page's text. Repetition at that density is a common sign of keyword stuffing, a practice listed in Google's spam policies.",
    "failing": {
      "label": "One word repeated through the copy",
      "lang": "html",
      "code": "<main>\n  <h1>Cheap flights to Paris</h1>\n  <p>Find cheap flights to Paris with Example Travel. Our cheap Paris\n  flights beat other cheap flights, so book cheap flights to Paris\n  today. Cheap flights, cheap Paris tickets, cheap flights every day.</p>\n  <!-- the same pattern repeats for 400 words -->\n</main>"
    },
    "measured": "On 2xx pages without a noindex meta tag and with at least 300 words, Septune counts each word in the first 12,000 characters of visible text, skipping English stop words, pure numbers and words under 3 or over 24 letters. A word is flagged when it occurs at least 6 times and its count is more than 6% of the page's total word count. The note lists up to 5 such words with their density, and at most 40 pages are listed. Words are counted one by one, so a repeated phrase shows up as its separate words.",
    "consequence": "Google's spam policies describe keyword stuffing and say pages that violate them can rank lower or not appear in results at all. The threshold is a prompt to read the page, not proof: a product name repeated in a spec table can cross it honestly.",
    "fix": "Read the passages where the word repeats. Replace repeats with pronouns, synonyms or the specific thing meant (\"the 7:40 flight\" instead of another \"cheap flights\"), delete lists of keyword variations, and remove blocks written only for search, such as hidden text or a footer of city names.",
    "verify": "In the DevTools console, compare document.body.innerText.match(/\\bcheap\\b/gi).length with document.body.innerText.split(/\\s+/).length, using the word from the note, then re-run the audit.",
    "related": [
      "content-keyword-alignment",
      "content-readability"
    ]
  },
  "img-alt-missing": {
    "summary": "Some <img> tags in your pages' HTML carry no alt text, or an empty one. Alt is what a screen reader reads out in place of the image, and one of the texts Google uses to understand what a picture shows.",
    "failing": {
      "label": "Server HTML with two images Septune counts",
      "lang": "html",
      "code": "<section class=\"team\">\n  <img src=\"/img/workshop.jpg\" width=\"1200\" height=\"800\">\n  <!-- empty alt: counted as missing too -->\n  <img src=\"/img/divider.svg\" alt=\"\" width=\"40\" height=\"4\">\n  <img src=\"/img/bowl.jpg\" alt=\"Potter shaping a bowl at the wheel\" width=\"600\" height=\"800\">\n</section>"
    },
    "measured": "Septune reads the HTML each page returns, without running JavaScript, on every crawled page that answers 2xx, noindex pages included. It looks at the first 120 <img> tags per page that have a src, and counts an image when its alt attribute is absent, written without quotes, empty, or only spaces. An intentional alt=\"\" on a decorative image is counted as well. The finding lists every affected page with how many images it has without alt.",
    "consequence": "Without alt, many screen readers announce the file name instead, and Google Images has only the surrounding page text to work out what the picture is about.",
    "fix": "Describe what the image shows in the context of the page, in a few words: \"Potter shaping a bowl at the wheel\" rather than \"image1\" or the file name. Logos, product photos and charts need it most. For a purely decorative image, alt=\"\" is correct HTML even though Septune lists it; a CSS background is the other way to add pure decoration.",
    "frameworks": {
      "nextjs": "next/image makes alt a required prop, so the reported images are usually alt=\"\" passed to it, or plain <img> tags coming from MDX or CMS HTML.",
      "astro": "Astro's <Image> requires alt, so check Markdown content: ![](./photo.jpg) renders an empty alt, ![Oak table in the showroom](./photo.jpg) does not."
    },
    "verify": "Run curl -s https://example.com/page | grep -io '<img[^>]*>' | grep -iv 'alt=\"[^\"]' to print the tags without a non-empty double-quoted alt (single-quoted ones also show up, check those by eye). When it prints nothing you meant to fix, re-run the audit.",
    "related": [
      "img-dimensions-missing",
      "img-broken",
      "img-lazy-missing"
    ]
  },
  "img-dimensions-missing": {
    "summary": "Some images have no width or height attribute, so the browser can't reserve their box before the file arrives. When each one loads, the content under it is pushed down, and that movement counts toward Cumulative Layout Shift.",
    "failing": {
      "label": "Two images reported, one that passes",
      "lang": "html",
      "code": "<article>\n  <!-- no width or height -->\n  <img src=\"/photos/bench.jpg\" alt=\"Workshop bench with clamps\">\n  <!-- not whole numbers: still counted -->\n  <img src=\"/photos/planes.jpg\" alt=\"Hand planes on a shelf\" width=\"100%\" height=\"auto\">\n  <!-- passes -->\n  <img src=\"/photos/oak.jpg\" alt=\"Oak boards drying\" width=\"1600\" height=\"900\">\n</article>"
    },
    "measured": "For each crawled page that answers 2xx, noindex ones included, Septune goes through every <img> with a src in the server HTML. An image is counted when width or height is missing or isn't a plain whole number, so width=\"100%\" or height=\"300px\" fail. Sizes set in CSS, aspect-ratio included, are not read. Each affected page is listed with its count.",
    "consequence": "Text and buttons jump while the page loads, which raises CLS in the Core Web Vitals report and can make a visitor tap the wrong link.",
    "fix": "Put the file's intrinsic pixel size in width and height, as numbers without units, and let CSS scale it: max-width: 100%; height: auto keeps the ratio. The browser derives the aspect ratio from the two attributes, so the image stays responsive and the space is held from the start.",
    "frameworks": {
      "nextjs": "next/image renders both attributes from its width and height props or a static import; with fill it renders neither, so those images are reported even when the parent box already holds the space.",
      "astro": "<Image> from astro:assets writes width and height for imported local files; a remote image needs them passed as props, or the inferSize prop."
    },
    "verify": "In the DevTools console, run [...document.querySelectorAll('img')].filter(i => !/^\\d+$/.test(i.getAttribute('width') || '') || !/^\\d+$/.test(i.getAttribute('height') || '')).map(i => i.src) and expect an empty array; the audit can be re-run once it is.",
    "related": [
      "perf-core-web-vitals",
      "img-lazy-missing",
      "perf-oversized-images"
    ]
  },
  "img-lazy-missing": {
    "summary": "A page with many images asks for almost all of them during the first load, including those far below the first screen. With loading=\"lazy\", the browser waits until the visitor scrolls near each one.",
    "failing": {
      "label": "A gallery where 1 image in 6 is lazy",
      "lang": "html",
      "code": "<ul class=\"gallery\">\n  <li><img src=\"/gallery/01.jpg\" alt=\"Kitchen after renovation\" width=\"800\" height=\"600\"></li>\n  <li><img src=\"/gallery/02.jpg\" alt=\"Bathroom wall tiles\" width=\"800\" height=\"600\"></li>\n  <li><img src=\"/gallery/03.jpg\" alt=\"Oak staircase\" width=\"800\" height=\"600\"></li>\n  <li><img src=\"/gallery/04.jpg\" alt=\"Terrace decking\" width=\"800\" height=\"600\"></li>\n  <li><img src=\"/gallery/05.jpg\" alt=\"Loft bedroom\" width=\"800\" height=\"600\"></li>\n  <li><img src=\"/gallery/06.jpg\" alt=\"Garden shed\" width=\"800\" height=\"600\" loading=\"lazy\"></li>\n</ul>"
    },
    "measured": "Septune only considers pages that answer 2xx and have at least 5 <img> tags with a src, counting the first 120 per page. A page is reported when fewer than 30% of those images carry loading=\"lazy\". It has no idea which images sit above the fold: the test is only the share of lazy images on the page. The note gives the page's image count.",
    "consequence": "On a slow connection, off-screen images take bandwidth from the ones the visitor actually sees, the largest visible image included, and are downloaded even if the visitor never scrolls that far.",
    "fix": "Add loading=\"lazy\" to images below the first screen: galleries, product grids, article bodies, footers. Leave the hero or main image without it, because lazy-loading the largest visible image delays LCP.",
    "frameworks": {
      "nextjs": "next/image lazy-loads by default, so the images counted here are usually plain <img> tags, from MDX or CMS HTML for instance.",
      "astro": "<Image> and <Picture> from astro:assets default to loading=\"lazy\"; a plain <img> tag needs the attribute written by hand."
    },
    "verify": "Open the page and run [...document.images].filter(i => i.loading === 'lazy').length + ' of ' + document.images.length in the DevTools console to compare lazy images with the total, then re-run the audit.",
    "related": [
      "img-dimensions-missing",
      "perf-oversized-images",
      "img-legacy-format"
    ]
  },
  "img-legacy-format": {
    "summary": "Some images are JPEG or PNG files above 100 KB. Re-encoded as WebP or AVIF at the same visual quality they would usually be lighter, and arrive sooner.",
    "failing": {
      "label": "HEAD response for /images/hero.jpg",
      "lang": "http",
      "code": "HTTP/1.1 200 OK\nContent-Type: image/jpeg\nContent-Length: 412870\nCache-Control: public, max-age=31536000"
    },
    "measured": "Septune sends a HEAD request, or a one-byte ranged GET when HEAD is refused, to the src of the first 48 distinct images found on 2xx pages (12 in the free web audit), on any host, skipping data: URIs. An image is reported when it answers 2xx, its Content-Type contains jpeg, jpg or png, and the size from Content-Length or Content-Range is over 100,000 bytes; images whose server reports no size are skipped. The format comes from the header, not the file extension. srcset and <picture> sources are not probed, and the request doesn't list WebP or AVIF in an Accept header. Up to 60 image URLs are listed with type and size, and they are not repeated under perf-oversized-images.",
    "consequence": "Every visit downloads more bytes than needed, and when the image is the largest element on screen, that extra download time adds directly to LCP.",
    "fix": "Convert the file to WebP or AVIF and point the src at the new file. If you keep a JPEG fallback inside <picture>, Septune still probes the <img> src and keeps reporting it; a WebP src works in every current browser. If an image service already chooses the format from the browser's Accept header, check what a browser receives before converting anything.",
    "frameworks": {
      "nextjs": "next/image serves WebP (or AVIF, with images.formats in next.config) only to requests that ask for it and the original format otherwise, so compare the two curl commands below before changing files.",
      "astro": "<Image> from astro:assets outputs WebP by default for files it processes, so the reported images are usually in public/ or remote, which Astro serves as they are."
    },
    "verify": "Run curl -sI https://example.com/images/hero.jpg and read Content-Type and Content-Length, the two headers Septune uses; run it again with -H 'Accept: image/avif,image/webp,*/*' to see what a browser gets. Re-run the audit after the change.",
    "related": [
      "perf-oversized-images",
      "img-lazy-missing",
      "perf-core-web-vitals"
    ]
  },
  "img-broken": {
    "summary": "Images referenced in your HTML answer with an HTTP error. Visitors see an empty box or a broken-image icon where the picture should be, and the file can't appear in image search.",
    "failing": {
      "label": "HEAD response for an image a page references",
      "lang": "http",
      "code": "HTTP/1.1 404 Not Found\nContent-Type: text/html; charset=utf-8\nContent-Length: 1834"
    },
    "measured": "Septune probes the src of the first 48 distinct images it meets on 2xx pages (12 in the free web audit) and follows up to 5 redirects. An image is reported when the final status is 400 or above. A timeout or network failure, which gives no status, is left out because it may be the connection; any 4xx counts, a 403 from hotlink protection included. Up to 40 image URLs are listed with their status, not the pages that use them.",
    "consequence": "The page renders with a hole in it, and Google has no file to index for that image.",
    "fix": "Open each listed URL. A 404 usually means a renamed or deleted file, a path whose letter case differs from the file name (most Linux hosts are case-sensitive), or a relative src such as images/a.png that resolves under the current page's folder. Fix the src or restore the file, and remove the <img> if the image is gone for good. For a 403 from a CDN, check whether it refuses requests that don't come from a browser.",
    "frameworks": {
      "nextjs": "Files in public/ are served from the root: public/team.jpg is /team.jpg, never /public/team.jpg.",
      "nuxt": "public/ is served from the root, while a file in assets/ only gets a URL when the build processes it, through ~/assets/ in a template or an import.",
      "astro": "Files in public/ are copied as-is to the root, but images imported from src/ get a hashed /_astro/ URL, so a hard-coded src pointing into src/assets/ breaks after the build.",
      "sveltekit": "Files in static/ are served from the root: static/team.jpg is /team.jpg."
    },
    "verify": "For each listed URL, run curl -sIL -o /dev/null -w '%{http_code}\\n' https://example.com/images/team.jpg and expect 200, then re-run the audit.",
    "related": [
      "perf-broken-assets",
      "perf-mixed-content",
      "img-alt-missing"
    ]
  },
  "schema-missing": {
    "summary": "Indexable pages carry no JSON-LD structured data. Without it they can't get the rich results that depend on markup, such as breadcrumbs, product details or events, and search engines have to infer what kind of page each one is.",
    "failing": {
      "label": "A JSON-LD block that fails to parse (trailing comma)",
      "lang": "html",
      "code": "<head>\n  <title>Oak dining table, 180 cm</title>\n  <script type=\"application/ld+json\">\n  {\n    \"@context\": \"https://schema.org\",\n    \"@type\": \"BreadcrumbList\",\n    \"itemListElement\": [],\n  }\n  </script>\n</head>"
    },
    "measured": "Septune parses every <script type=\"application/ld+json\"> in the server HTML of each indexable page (2xx, and no noindex in a robots or googlebot meta tag) and reports the pages where none parsed. A block that isn't valid JSON is dropped without a warning, so one trailing comma makes the page count as having no structured data. Microdata and RDFa are not read, and JSON-LD added by JavaScript after load is not seen. Every affected page is listed.",
    "consequence": "The page isn't eligible for structured-data rich results, and search engines classify it from its text alone.",
    "fix": "Add a JSON-LD block that states what the page is: BreadcrumbList on inner pages, Article on posts, Product on product pages, Organization or WebSite on the homepage. Render it on the server so it is in the HTML response. If a tag manager injects it today, Google may still read it after rendering, but Septune and other crawlers that don't run scripts won't see it.",
    "frameworks": {
      "nextjs": "Render <script type=\"application/ld+json\" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} /> from the page's Server Component so it ships in the HTML.",
      "nuxt": "Call useHead({ script: [{ type: 'application/ld+json', innerHTML: JSON.stringify(data) }] }) in the page; with SSR on, it is rendered on the server.",
      "astro": "Add <script type=\"application/ld+json\" set:html={JSON.stringify(data)} /> to the layout's <head>; Astro leaves a script with a type attribute unbundled.",
      "sveltekit": "Inside <svelte:head>, print the whole <script type=\"application/ld+json\"> tag with {@html}, building the string from JSON.stringify(data)."
    },
    "verify": "Count the blocks in the raw HTML with curl -s https://example.com/page | grep -c 'application/ld+json', paste the block into the Schema Markup Validator (validator.schema.org) to confirm it parses, and re-run the audit.",
    "related": [
      "schema-invalid",
      "schema-website-missing"
    ]
  },
  "schema-invalid": {
    "summary": "A page has JSON-LD for a rich-result type but leaves out a property Google requires for it, for example a Product with no offers, review or rating. Google won't show that rich result until the field is there.",
    "failing": {
      "label": "A Product without offers, review or aggregateRating",
      "lang": "html",
      "code": "<script type=\"application/ld+json\">\n{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"Product\",\n  \"name\": \"Oak dining table, 180 cm\",\n  \"image\": \"https://example.com/img/table.jpg\",\n  \"brand\": { \"@type\": \"Brand\", \"name\": \"Example Joinery\" }\n}\n</script>"
    },
    "measured": "On indexable pages, Septune walks each parsed JSON-LD block (top-level objects, arrays and @graph entries) and checks eight types against a fixed list of required properties: Product (name, plus one of offers, review or aggregateRating), BreadcrumbList (itemListElement), Event (name, startDate, location), LocalBusiness (name, address), Recipe (name, image), VideoObject (name, thumbnailUrl, uploadDate), JobPosting (title, datePosted, description, hiringOrganization) and Review (author, reviewRating). A property is missing when it is absent, null or an empty string; values are not checked further. @type must match exactly, so a subtype such as Restaurant is skipped, objects nested inside a property are not checked, and every other type is ignored. Up to 40 pages are listed with up to 3 problems each.",
    "consequence": "That item isn't eligible for its rich result, and Search Console's rich result report for the type, where one exists, lists it as invalid.",
    "fix": "Fill the missing property from data the page already shows: price and currency in offers, the date and venue of an event, the street address of a business. Don't mark up values a visitor can't see on the page; Google's structured data guidelines require the markup to match the visible content.",
    "verify": "Test the URL in Google's Rich Results Test (search.google.com/test/rich-results), which names each missing required field. When it reports none for the type, re-run the audit.",
    "related": [
      "schema-missing",
      "schema-website-missing"
    ]
  },
  "schema-website-missing": {
    "summary": "The homepage has no JSON-LD of type Organization or WebSite. Google reads WebSite markup on the homepage when it picks the site name shown in results, and Organization markup for details such as the logo.",
    "failing": {
      "label": "Homepage JSON-LD with only a WebPage node",
      "lang": "html",
      "code": "<!-- https://example.com/ -->\n<script type=\"application/ld+json\">\n{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"WebPage\",\n  \"name\": \"Example Joinery, custom furniture in Lyon\"\n}\n</script>"
    },
    "measured": "Septune takes the crawled page whose path matches the audit's start URL, usually /, provided it answered 2xx, and collects the @type values of its JSON-LD, @graph entries included. It reports the page when neither Organization nor WebSite is among them. The match is literal, so a subtype such as LocalBusiness or Corporation doesn't count. If the start URL redirected to another path, such as /en/, no page matches and the rule doesn't run. The evidence line lists the types it found.",
    "consequence": "Google falls back to other sources for the site name, such as the title, headings or og:site_name, and may show a name you didn't choose.",
    "fix": "Give the homepage one JSON-LD block with a WebSite node (name, url) and, for a company or a brand, an Organization node (name, url, logo), both in a single @graph. A LocalBusiness on its own doesn't satisfy this check, so add the WebSite node beside it.",
    "frameworks": {
      "nextjs": "Render the script in app/page.tsx for the homepage only, or in app/layout.tsx if every page should carry the same WebSite node."
    },
    "verify": "List the types in the homepage HTML with curl -s https://example.com/ | grep -o '\"@type\": *\"[A-Za-z]*\"'; WebSite or Organization should be among them before you re-run the audit.",
    "related": [
      "schema-missing",
      "schema-invalid"
    ]
  },
  "link-orphan-pages": {
    "summary": "A crawled page receives no internal link from any other crawled page. Visitors browsing the site never reach it, and a crawler that follows links can only learn of it from the sitemap or a link on another site.",
    "failing": {
      "label": "A sitemap entry that no page links to",
      "lang": "xml",
      "code": "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url><loc>https://example.com/</loc></url>\n  <url><loc>https://example.com/guides</loc></url>\n  <url><loc>https://example.com/guides/migrating-from-v1</loc></url>\n</urlset>\n<!-- /guides links to /guides/setup and /guides/deploy,\n     never to /guides/migrating-from-v1 -->"
    },
    "measured": "Septune builds a link graph from the server HTML of every crawled page; JavaScript isn't run, so links added in the browser don't count. A link counts when its href starts with / or with the page's own origin, among the first 300 links of the page. Self-links are ignored, nofollow links are counted, and URLs are compared by path, without trailing slash, query string or fragment. Every crawled page with zero inbound links is reported whatever its status, except the start URL and pages whose robots meta tag says noindex or none. Pages that only the sitemap led to carry the note \"listed in the sitemap, but no crawled page links to it\". A link to a URL that redirects counts for the path written in the href, so a page reached only through redirecting links is reported too. When the crawl stopped at its page limit, the evidence says so and confidence drops from 90 to 60, since an uncrawled page may hold the link.",
    "consequence": "No path through the site leads to the page, so it gets no visitors from navigation and no context from the pages around it. Its discovery rests on the sitemap alone, which tells a search engine the URL exists and nothing about what it relates to.",
    "fix": "Link to the page from the pages that cover the same subject: a hub or category page, a related article, or the navigation if the page matters enough, with anchor text that names it. If the page is obsolete, take it out of the sitemap and delete it or redirect it to its replacement. If it should stay out of search on purpose (a campaign landing page, a thank-you page), give it <meta name=\"robots\" content=\"noindex\">, which also removes it from this report.",
    "verify": "Fetch the page that should now link to it and look for the href in the server HTML: curl -s https://example.com/guides | grep -o 'href=\"/guides/migrating-from-v1\"' should print at least one match, then re-run the audit.",
    "related": [
      "indexing-sitemap-gaps",
      "link-deep-pages",
      "link-missing-internal-opportunities"
    ]
  },
  "link-deep-pages": {
    "summary": "These pages take four clicks or more to reach from the start page. Deep pages usually sit at the end of pagination or nested categories, and they're the last ones a visitor or a crawler gets to.",
    "failing": {
      "label": "Shortest click path to an old blog post",
      "lang": "text",
      "code": "/                              depth 0\n/blog                          depth 1\n/blog/page/2                   depth 2\n/blog/page/3                   depth 3\n/blog/2021/http-caching-guide  depth 4   reported"
    },
    "measured": "While crawling, Septune gives each page the click depth at which it first reached it: 0 for the start URL, then one more per link, following internal links (href starting with / or with the site's origin) breadth first through the server HTML. Every crawled page at depth 4 or more is listed with its depth, whatever status it answered, and the evidence also gives the deepest level reached. Pages found only through the sitemap have no link depth and are left out of this rule. Only crawled pages count: when the crawl stops at its page limit, a deeper section may not be reached at all.",
    "consequence": "Each extra level is one more page where the visitor must pick the right link. On a paginated archive, a post sinks one level further every time enough new posts are published to fill a page.",
    "fix": "Shorten the path by linking the page from somewhere closer to the start page: a hub or category page, a related article, a list of popular or recent guides. For paginated archives, add category or tag pages, or show more items per page, so old entries don't sink with each new post. Breadcrumbs on the deep page don't help here, because they link up from it, and the rule needs a link down to it.",
    "verify": "Follow the links from the homepage in the page source (curl -s https://example.com/blog | grep -o 'href=\"/blog/[^\"]*\"' lists the next hops) and count the clicks to the page: the shortest path should be three or fewer, then re-run the audit.",
    "related": [
      "link-orphan-pages",
      "link-missing-internal-opportunities"
    ]
  },
  "link-broken-internal": {
    "summary": "A crawled page links to another page of the same site, and that page answered with an HTTP error when Septune fetched it. Whoever clicks lands on an error, and the link keeps sending crawlers to a URL with nothing to index.",
    "failing": {
      "label": "A navigation link to a page that answers 404",
      "lang": "html",
      "code": "<!-- https://example.com/features -->\n<nav>\n  <a href=\"/docs\">Docs</a>\n  <a href=\"/pricing-2023\">Pricing</a>\n  <a href=\"/contact\">Contact</a>\n</nav>\n<!-- GET /pricing-2023 answered HTTP/1.1 404 Not Found -->"
    },
    "measured": "For each crawled page, Septune reads the internal links (href starting with / or with the site's origin, first 300 per page) and matches their path, without trailing slash, query or fragment, against the pages it crawled. A link is reported when it matches a crawled page whose status was 400 or higher: 404 and 410, but also 401, 403, 429 and 5xx. Each linking page and target pair is listed once, as the linking page with the target path and its status in the note. Targets Septune didn't crawl aren't judged here; they may be probed over HTTP under link-broken-external.",
    "consequence": "A broken link in a shared navigation or footer repeats on every page that uses it, so one dead URL can produce hundreds of entries. Visitors who follow it leave the path they were on, and crawlers spend a request on it at every visit.",
    "fix": "Point the href at the page that replaced the target, or remove the link. If the page moved, also add a permanent (301 or 308) redirect from the old URL so outside links and bookmarks follow. A 5xx may be a server error on a page that exists, so open it before deleting links. A members-only target that answers 401 or 403 on purpose will keep being reported; keep such links off public pages where you can.",
    "frameworks": {
      "nextjs": "Add the old path to redirects() in next.config with permanent: true, and update the <Link href> values that still point to it.",
      "nuxt": "Declare the move in routeRules in nuxt.config.ts ('/old': { redirect: { to: '/new', statusCode: 301 } }) and fix the <NuxtLink to> values.",
      "astro": "Map the old path to the new one in the redirects option of astro.config.mjs and update the links in components and Markdown.",
      "sveltekit": "Keep a +page.server.ts at the old path whose load calls redirect(308, '/new') from @sveltejs/kit, and fix the href values."
    },
    "verify": "curl -s -o /dev/null -w '%{http_code}\\n' https://example.com/pricing-2023 shows what the old target answers, and curl -s https://example.com/features | grep -c 'href=\"/pricing-2023\"' should print 0 once the link is fixed, then re-run the audit.",
    "related": [
      "link-broken-external",
      "indexing-broken-page",
      "indexing-temporary-redirect"
    ]
  },
  "link-broken-external": {
    "summary": "A link on the site leads to a URL that answers 404, 410 or 500. Most are links to other sites that moved or deleted a page, but internal links to pages Septune didn't crawl are checked the same way.",
    "failing": {
      "label": "Probe of a linked article that no longer exists",
      "lang": "http",
      "code": "HEAD /blog/2019/launch-announcement HTTP/1.1\nHost: example.org\nUser-Agent: SeptuneBot/1.0 (+https://www.septune.dev/docs/agent)\n\nHTTP/1.1 404 Not Found\nContent-Type: text/html; charset=utf-8"
    },
    "measured": "Septune collects the <a href> links of pages that answered 2xx (first 300 per page), resolves each against its page and skips internal links whose path is a crawled 2xx page. The first 64 distinct URLs (16 in the free audit on septune.dev) get a HEAD request, or a one-byte ranged GET when HEAD fails or answers 405 or 501, with up to 5 redirects followed inside one 7-second budget (4 seconds in the free audit). Only a final status of 404, 410 or 500 is reported. 502, 503 and 504 are treated as temporary, and 401, 403, 429 and timeouts as unverifiable, since many sites turn bots away. Up to 60 URLs are listed, each one the broken destination, not the page that links to it. Daily monitoring checks don't run this probe.",
    "consequence": "The visitor who trusted the link ends on someone else's error page, and the reference it was meant to provide is lost. A page full of dead outbound links also tells readers that nobody maintains it.",
    "fix": "Search your source code and CMS content for the listed URL to find the pages that use it. Point the link at the page's new address if the other site moved it, at an archived copy (web.archive.org) if the content is gone, or remove it. For a 500, open the URL in a browser first: some servers fail only on HEAD requests or on unknown user agents, and the link may be fine for people.",
    "verify": "curl -sIL -o /dev/null -w '%{http_code}\\n' https://example.org/blog/2019/launch-announcement prints the final status after redirects; once the link is replaced or removed, re-run the audit.",
    "related": [
      "link-broken-internal",
      "indexing-redirect-chain",
      "link-malformed"
    ]
  },
  "link-malformed": {
    "summary": "An href on the page has a typo that changes where it leads: one slash or no colon after the scheme, a misspelled scheme, a backslash or a space. Browsers send some of these to a path on your own site, and repair others in ways not every parser copies.",
    "failing": {
      "label": "Links with typos in their href",
      "lang": "html",
      "code": "<p>\n  Start with the <a href=\"https:/example.org/docs/setup\">setup guide</a>,\n  read the <a href=\"https//example.org/changelog\">changelog</a>,\n  see our <a href=\"/guides\\deploy\">deploy notes</a>\n  or the <a href=\"/case studies/bakery\">case study</a>.\n</p>"
    },
    "measured": "On every page that answered 2xx, Septune trims each <a href> (first 300 links, internal and external) and skips fragments and mailto:, tel:, javascript:, data: and sms: links. An href is reported when it starts with http:/ or https:/ followed by a single slash, starts with http// or https// (no colon), uses a misspelled scheme (htp, htps, htt, hhtp, htttp, htttps, ttp or ttps), contains a backslash, or contains whitespace between two characters. Each page is listed once, with up to two of its malformed hrefs, cut at 60 characters, and the reason for each.",
    "consequence": "Browsers resolve these by the URL Standard, and the result depends on the typo. On an https page, https:/example.org/docs becomes https://example.com/example.org/docs and https//example.org becomes a path under the current page: both land on your own site, usually on a 404. A misspelled scheme like htps: isn't a web address at all. A backslash is read as a slash and a space is sent as %20, so those links may work in a browser while a stricter tool treats them as different URLs.",
    "fix": "Correct the href where it's written, usually a hand-typed link in CMS content or Markdown: a full https:// prefix, forward slashes only, and no spaces (rename the target with hyphens, or encode the space as %20). When links are built by joining strings in a template, check that code, since a missing colon or slash in a base URL repeats on every page that uses it.",
    "verify": "curl -s https://example.com/about | grep -oE 'href=\"(https?:/[^/]|https?//|[^\"]*[\\\\ ])[^\"]*\"' prints the hrefs that still have a single slash, a missing colon, a backslash or a space; no output means they're fixed, then re-run the audit.",
    "related": [
      "link-broken-internal",
      "link-broken-external"
    ]
  },
  "link-generic-anchors": {
    "summary": "Internal links whose entire text is a phrase like \"click here\" or \"read more\" say nothing about where they lead. Search engines read anchor text as a description of the target page, and screen-reader users who pull up a list of links hear the same label over and over.",
    "failing": {
      "label": "Blog teaser and notice with generic link text",
      "lang": "html",
      "code": "<article>\n  <h2>Faster CI with incremental caching</h2>\n  <p>How we stopped rebuilding the dependency graph on every push.\n    <a href=\"/blog/incremental-caching\">Read more</a></p>\n</article>\n<p>Our pricing changed in March. Details <a href=\"/pricing\">here</a>.</p>"
    },
    "measured": "On every page that answered 2xx, Septune takes each internal link (href starting with / or with the page's origin, first 300 links), removes the tags inside it, decodes entities, collapses whitespace and lowercases the text. The link counts when that text is exactly one of: click here, here, read more, learn more, this, link, more. Longer text containing those words passes, as does a link whose only content is an image; alt text and aria-label aren't read. External links aren't checked. Each page is listed with its number of generic anchors.",
    "consequence": "Google uses anchor text to understand the page a link points to, so a generic label gives it nothing to go on for the target. A visitor scanning for the next step, or tabbing from link to link, can't tell one \"read more\" from another without reading around it.",
    "fix": "Rewrite the text so it names the destination: \"Read the incremental caching write-up\" instead of \"Read more\", or make the article's title the link. If the design calls for a short visible label, put the rest of the description inside the link in a visually hidden span; screen readers announce it, and Septune counts it as part of the anchor.",
    "verify": "curl -s https://example.com/blog | grep -ioE '<a [^>]*>(click here|here|read more|learn more|this|link|more)</a>' lists the generic links left in the server HTML (links with tags inside need a look in the source), then re-run the audit.",
    "related": [
      "link-missing-internal-opportunities",
      "link-orphan-pages"
    ]
  },
  "link-missing-internal-opportunities": {
    "summary": "Septune found pairs of indexable pages whose text covers the same subject and suggests a link from one to the other. Related pages that point to each other give readers a next step and give crawlers a path between them.",
    "failing": {
      "label": "A guide that never mentions its closest neighbour",
      "lang": "html",
      "code": "<!-- https://example.com/guides/image-optimization -->\n<h1>Optimizing images for the web</h1>\n<p>Convert photos to WebP or AVIF, then serve each screen\n  the right size with srcset and sizes.</p>\n<!-- /guides/responsive-images covers srcset and sizes in depth,\n     and this page has no link to it -->"
    },
    "measured": "Septune turns each indexable page (2xx, no noindex in the robots meta tag) into a 512-dimension vector computed in-process from its title, headings and first 12,000 characters of visible text, by hashing its words, word stems, a short list of SEO synonyms and character trigrams. No model or outside service is called. For each page, the other pages with a cosine similarity of 0.55 or more are ranked and the top two become suggestions, skipping a pair when the first page already links to the second and pairs in the same near-duplicate cluster (72% shingle overlap or more). The 40 strongest suggestions are kept and the 30 strongest listed, each with the page to link from, the page to link to, an anchor hint (the target's title, else its H1, first heading or path) and the similarity as a percentage.",
    "consequence": "A reader who finishes one page and wants the related one has to go back to search or the menu to find it. The two pages also stay further apart in the site's link graph than their subjects are.",
    "fix": "Review each suggestion before acting: the score measures shared vocabulary, so two pages can score high without one being a useful next step from the other. Where the link makes sense, add it in the body text next to the passage that touches the other subject, with anchor text that names the target; the anchor hint is a starting point. A related-articles block also works, but a link inside a sentence tells the reader why to follow it.",
    "verify": "curl -s https://example.com/guides/image-optimization | grep -o 'href=\"/guides/responsive-images\"' should print the new link, then re-run the audit.",
    "related": [
      "link-orphan-pages",
      "link-generic-anchors",
      "indexing-duplicate-content"
    ]
  },
  "perf-core-web-vitals": {
    "summary": "Real Chrome users of the site get a Largest Contentful Paint, Interaction to Next Paint or Cumulative Layout Shift outside Google's \"good\" range. These are field measurements from Google's Chrome UX Report, the data behind Search Console's Core Web Vitals report.",
    "failing": {
      "label": "CrUX field data for the start URL (excerpt)",
      "lang": "text",
      "code": "POST https://chromeuxreport.googleapis.com/v1/records:queryRecord\n{\"url\": \"https://example.com/\"}\n\n\"largest_contentful_paint\":  { \"percentiles\": { \"p75\": 4310 } }\n\"interaction_to_next_paint\": { \"percentiles\": { \"p75\": 180 } }\n\"cumulative_layout_shift\":   { \"percentiles\": { \"p75\": \"0.18\" } }\n\nLCP 4.3 s (poor), INP 180 ms (good), CLS 0.18 (needs improvement)"
    },
    "measured": "This rule runs only when Septune has a CrUX API key: the CLI's --vitals flag (with CRUX_API_KEY or --crux-key), or daily monitoring on a server where CRUX_API_KEY is set. Without a key, or when Google has no data for the site, nothing is reported and no score is guessed. Septune queries the CrUX API for the start URL, all devices together, and falls back to the whole origin when the URL has too few visits. It reads the 75th percentile over the last 28 days and rates each metric with Google's boundaries: LCP good up to 2,500 ms and poor above 4,000 ms, INP good up to 200 ms and poor above 500 ms, CLS good up to 0.1 and poor above 0.25. The issue appears when at least one of the three isn't good, with high impact if one is poor and medium otherwise. Only the start URL or its origin is measured, not each crawled page.",
    "consequence": "A slow LCP means visitors wait for the main content, a high INP means taps and clicks that seem to do nothing for a moment, and a high CLS means content that jumps while they read. Search Console reports the same failures in its Core Web Vitals report, grouped by similar URLs.",
    "fix": "Work on the metric that fails. For LCP, find the largest element in the first screen, usually the hero image or headline, and get it to the browser sooner: serve the image at its displayed size from your own origin, give it fetchpriority=\"high\" and don't lazy-load it. For INP, split long JavaScript tasks that run on input and delay third-party scripts until after load. For CLS, reserve space for images, embeds and ads with width and height or aspect-ratio, and load web fonts with a fallback of similar metrics.",
    "frameworks": {
      "nextjs": "Load fonts through next/font, which self-hosts them and adjusts the fallback font's metrics, and render the hero with next/image, which sets its dimensions and serves a resized file."
    },
    "verify": "Field data moves slowly: the 28-day window needs four weeks to fully reflect a deploy. Check right away with Lighthouse in Chrome DevTools on a mobile profile (it measures LCP and CLS in the lab), follow the field numbers in Search Console's Core Web Vitals report, then re-run the audit once the window has moved.",
    "related": [
      "perf-slow-ttfb",
      "perf-render-blocking",
      "img-dimensions-missing"
    ]
  },
  "perf-slow-ttfb": {
    "summary": "These pages took more than 800 ms to send back their first response headers when Septune fetched them. Nothing on the page can load before that first response, so every later step starts late.",
    "failing": {
      "label": "Timing a slow page with curl",
      "lang": "text",
      "code": "$ curl -s -o /dev/null -w 'TTFB %{time_starttransfer}s\\n' https://example.com/pricing\nTTFB 1.420s"
    },
    "measured": "For each page that answered 2xx, Septune times its own request from the moment it's sent until the response headers arrive, every redirect included. It's one measurement per page, taken during the crawl from the machine running the audit (yours with the CLI, Septune's server for hosted audits), with several pages fetched in parallel (4 by default). Pages over 800 ms are listed with their time in milliseconds; 800 ms is also where web.dev puts the limit of a good TTFB.",
    "consequence": "Time to first byte comes before every other metric: a page whose HTML takes 1.4 s to start arriving can't show its main content sooner than that. Google's crawler also lowers its crawl rate on a host that responds slowly, so fewer pages get fetched per visit.",
    "fix": "Find out where the time goes first: a Server-Timing header or the host's logs show whether it's the database, an API call or rendering. Pages that are the same for every visitor can be prerendered at build time or cached at a CDN edge, so the server answers from cache. For pages that must stay dynamic, cache the slow data calls, and check that a redirect isn't adding a round trip, since the measured time includes every hop. One measurement can be noise: if a single page is slow and the rest are fast, time it again before changing anything.",
    "frameworks": {
      "nextjs": "Next.js renders a route on every request once it reads cookies(), headers() or searchParams; keep those reads out of pages that are the same for every visitor so they can be prerendered, and cache slow data fetches.",
      "nuxt": "Use routeRules in nuxt.config.ts to prerender pages that rarely change ('/about': { prerender: true }) or to cache them stale-while-revalidate ('/blog/**': { swr: 3600 }).",
      "astro": "With server output, add export const prerender = true to pages that are the same for everyone, so they're built once instead of rendered per request.",
      "sveltekit": "Add export const prerender = true to the +page.ts or +layout.ts of routes that don't depend on the request, so they're served as static files."
    },
    "verify": "Run curl -s -o /dev/null -w '%{time_starttransfer}\\n' https://example.com/pricing three or four times: the figure, in seconds, should stay under 0.8, then re-run the audit.",
    "related": [
      "perf-core-web-vitals",
      "perf-heavy-html",
      "indexing-redirect-chain"
    ]
  },
  "perf-render-blocking": {
    "summary": "The <head> of these pages loads three or more scripts and stylesheets that the browser has to download before it shows anything. The page stays blank until the slowest of them arrives.",
    "failing": {
      "label": "Head with four blocking files",
      "lang": "html",
      "code": "<head>\n  <meta charset=\"utf-8\">\n  <link rel=\"stylesheet\" href=\"/css/reset.css\">\n  <link rel=\"stylesheet\" href=\"/css/main.css\">\n  <script src=\"/js/jquery.min.js\"></script>\n  <script src=\"/js/carousel.js\"></script>\n  <script src=\"/js/app.js\" defer></script>\n  <link rel=\"stylesheet\" href=\"/css/print.css\" media=\"print\">\n</head>"
    },
    "measured": "Septune reads the <head> of every page that answered 2xx. It counts <script> tags that have a src, have neither async nor defer and aren't type=\"module\", and <link rel=\"stylesheet\"> tags except those with media=\"print\". A page is reported when the two add up to 3 or more, with each count in the note. Inline <script> and <style> blocks aren't counted, and neither is anything outside the <head>.",
    "consequence": "Stylesheets hold back the first paint until they're downloaded, and a synchronous script stops the parser until it has been fetched and run. First Contentful Paint waits for all of them, and LCP with it. Files on another host are slower still, since the browser first has to look up and connect to that host.",
    "fix": "Give scripts that don't need to run before the first paint the defer attribute, which keeps their order, or async for independent ones such as analytics. Merge small first-party stylesheets, inline the CSS the first screen needs and load the rest without blocking. Self-host web font CSS instead of fetching it from another domain.",
    "frameworks": {
      "nextjs": "Load third-party scripts with the Script component from next/script, whose default afterInteractive strategy runs them after hydration, rather than a raw <script> tag in app/layout.tsx.",
      "nuxt": "Add defer: true to the script entries of useHead or app.head, or tagPosition: 'bodyClose' to move them to the end of the body.",
      "astro": "Astro bundles the <script> tags it processes as type=\"module\", which don't block rendering; scripts it leaves as written (is:inline, or with attributes other than src) need defer added by hand.",
      "sveltekit": "SvelteKit loads its own JavaScript as modules, so blocking tags usually come from src/app.html or a <svelte:head>: add defer there."
    },
    "verify": "curl -s https://example.com/ | sed -n '/<head/,/<\\/head>/p' | grep -E '<script[^>]+src=|rel=\"stylesheet\"' lists the head's candidates; every script line should carry defer, async or type=\"module\", and at most two blocking files should remain, then re-run the audit.",
    "related": [
      "perf-core-web-vitals",
      "perf-broken-assets",
      "perf-heavy-html"
    ]
  },
  "perf-oversized-images": {
    "summary": "These image files are heavy: WebP or AVIF over 500 KB, or GIF, SVG and other formats over 300 KB. On a mobile connection one such file can be the slowest download of the page, and if it's the main image of the first screen it sets the LCP.",
    "failing": {
      "label": "Probe of a 1.8 MB hero image",
      "lang": "http",
      "code": "HEAD /images/hero-banner.webp HTTP/1.1\nHost: example.com\n\nHTTP/1.1 200 OK\nContent-Type: image/webp\nContent-Length: 1843200"
    },
    "measured": "Septune probes the first 48 distinct <img src> URLs found on pages that answered 2xx (12 in the free audit on septune.dev), skipping data: URIs. Each gets a HEAD request, or a one-byte ranged GET when HEAD fails, and the size is read from Content-Length or from the total in Content-Range. WebP and AVIF files over 500,000 bytes are reported, and files of any other type except JPEG and PNG over 300,000 bytes. JPEG and PNG are left to img-legacy-format, which takes those over 100,000 bytes, so no file is reported twice. Images that declare no size or answer outside 2xx are skipped, and srcset candidates and CSS backgrounds aren't read. The note gives each size in KB.",
    "consequence": "The image competes for bandwidth with everything else the page needs, and on a phone its download alone can take seconds. Visitors on metered mobile plans pay for every one of those bytes.",
    "fix": "Resize the file to the largest size it's shown at, and serve smaller copies to small screens with srcset and sizes. Re-encode WebP or AVIF at a lower quality and compare by eye. An animated GIF is lighter as a muted, looping MP4 or WebM in a <video> element, and an SVG this heavy usually embeds a bitmap or carries unoptimized paths: run it through SVGO, or export a WebP if it's really a picture.",
    "frameworks": {
      "nextjs": "Render it with next/image and a sizes prop, so the image optimizer serves a resized copy per screen width instead of the original file.",
      "nuxt": "Use <NuxtImg> from @nuxt/image with sizes, so each screen width gets its own resized file.",
      "astro": "Use <Image /> or <Picture /> from astro:assets with widths and sizes; local images are resized at build time.",
      "sveltekit": "Use <enhanced:img> from @sveltejs/enhanced-img, which generates resized AVIF and WebP copies of local images at build time."
    },
    "verify": "curl -sI https://example.com/images/hero-banner.webp | grep -i content-length shows the new size in bytes, which should be under 500000 for WebP or AVIF and 300000 for other formats, then re-run the audit.",
    "related": [
      "img-legacy-format",
      "img-lazy-missing",
      "perf-core-web-vitals"
    ]
  },
  "perf-heavy-html": {
    "summary": "These pages return more than 250 KB of HTML once decompressed. The browser has to parse every byte before the page settles, and documents that size often carry data the visitor never sees.",
    "failing": {
      "label": "A product listing that ships its catalog twice",
      "lang": "html",
      "code": "<!-- https://example.com/products, 412 KB of HTML -->\n<body>\n  <main>\n    <ul class=\"product-grid\">\n      <li>...</li>  <!-- 600 products rendered in full -->\n    </ul>\n  </main>\n  <script id=\"page-data\" type=\"application/json\">\n    {\"products\":[{\"id\":1,\"name\":\"Trail shoe\",\"variants\":[...]}, ...]}\n  </script>\n</body>"
    },
    "measured": "For every page that answered 2xx, Septune measures the HTML body in bytes after decompression, so gzip or Brotli don't lower the figure, and reports pages over 250,000 bytes with the size in KB. The crawler stops reading a page at 512 KB, so a larger page shows as about 512 KB.",
    "consequence": "Compression shrinks the transfer, but the parser still works through the full document, and on a mid-range phone that adds to the time before the page responds to input. When the same content is shipped twice, once as HTML and once as data for hydration, the cost doubles for nothing.",
    "fix": "Open the page source and find what takes the space. Inline <script> blocks of serialized data, the same SVG icon pasted into every list item, and long lists rendered in full are the usual causes. Send the client only the fields it displays, reference repeated icons from one sprite with <use>, and paginate long lists or load the rest on demand.",
    "frameworks": {
      "nextjs": "Props passed from a Server Component to a Client Component are serialized into the HTML as the RSC payload, so pass the client component only the fields it renders.",
      "nuxt": "Results of useFetch and useAsyncData are serialized into the page payload; use their pick or transform options to keep only what the page renders.",
      "astro": "Props of a hydrated island (client:*) are serialized into the HTML, so pass the island only what it needs and render the rest as static HTML.",
      "sveltekit": "Data returned by a server load function, and responses fetched with SvelteKit's fetch during server rendering, are inlined in the HTML; return and fetch only what the page uses."
    },
    "verify": "curl -s --compressed https://example.com/products | wc -c prints the decompressed size in bytes, which should be under 250000, then re-run the audit.",
    "related": [
      "perf-slow-ttfb",
      "perf-render-blocking",
      "perf-core-web-vitals"
    ]
  },
  "perf-mixed-content": {
    "summary": "An https:// page loads an image over plain http://, either written that way or through a redirect to an http address. That part of the page travels unencrypted, and browsers react by upgrading or dropping the image.",
    "failing": {
      "label": "Team page on https with http images",
      "lang": "html",
      "code": "<!-- served at https://example.com/about -->\n<section class=\"team\">\n  <img src=\"http://example.com/uploads/team-2022.jpg\" alt=\"The team at the spring offsite\">\n  <img src=\"http://images.example.com/office.png\" alt=\"Our office\">\n</section>"
    },
    "measured": "Among the first 48 distinct <img src> URLs on pages that answered 2xx (12 in the free audit on septune.dev), Septune flags those used on an https:// page that are written with http://, or that redirect to an http:// address when probed. The flag doesn't depend on whether the image loads. Links (<a href>) are excluded on purpose, since browsers neither block nor warn on a link to an http page, and scripts, stylesheets, srcset and CSS backgrounds aren't checked. Up to 40 image URLs are listed.",
    "consequence": "Chrome requests these images over https instead and drops them when that fails, so an image host without https leaves a broken image on the page. Anything that does travel over http can be read or replaced by anyone on the network path.",
    "fix": "Change the image URLs to https://, or to relative paths when the image is on your own site. Check first that the image host serves the file over https; if it doesn't, copy the image to your own server. Look in CMS content and old database rows, which keep absolute http:// URLs long after a site moves to https. As a stopgap, a Content-Security-Policy: upgrade-insecure-requests header makes browsers request every http:// sub-resource over https.",
    "verify": "curl -s https://example.com/about | grep -o 'src=\"http://[^\"]*\"' should print nothing, and the DevTools Console should show no mixed content warning for the page, then re-run the audit.",
    "related": [
      "indexing-https-certificate",
      "indexing-http-not-redirected",
      "img-broken"
    ]
  },
  "perf-broken-assets": {
    "summary": "A page asks for a stylesheet or a script on its own host, and the file answers with an HTTP error. Visitors get the page unstyled or without its JavaScript, and so does Google when it renders the page.",
    "failing": {
      "label": "Probe of a script left behind by the previous build",
      "lang": "http",
      "code": "HEAD /assets/app.3f9c2b.js HTTP/1.1\nHost: example.com\n\nHTTP/1.1 404 Not Found\nContent-Type: text/html; charset=utf-8"
    },
    "measured": "In the first 60,000 characters of each 2xx page's HTML, Septune collects <link rel=\"stylesheet\"> hrefs and <script src> URLs, keeping only files on exactly the page's host, so a CDN subdomain or a third party isn't included. Up to 32 distinct files per audit are probed with HEAD, or a one-byte ranged GET when HEAD fails or answers 405 or 501, with up to 5 redirects followed. A file is reported when its final status is 400 or higher; timeouts and network errors don't count. Up to 40 files are listed by path with their status. The daily monitoring check skips this probe.",
    "consequence": "Google renders pages with the files it can fetch, so content a missing script would have inserted, or a layout a missing stylesheet would have applied, is absent from what it sees. When the missing file is the main bundle, a client-rendered page can be empty for everyone.",
    "fix": "The usual cause is a deploy: HTML cached by a CDN or a browser still points to the hashed file names of the previous build, which the new build removed. Purge the HTML cache on each deploy, or keep the previous build's static files online for a while. Otherwise, compare the path in the template (a missing base path, a typo, a file left out of the build output) with what the server actually has.",
    "frameworks": {
      "nextjs": "Missing files under /_next/static/ usually mean stale HTML or a deploy that didn't copy .next/static; on a sub-path, check basePath and assetPrefix in next.config.",
      "nuxt": "Built files are served from /_nuxt/ by default; for a sub-path or a CDN, check app.baseURL and app.cdnURL in nuxt.config.ts.",
      "astro": "Built files go to /_astro/; when the site lives under a sub-path, set base in astro.config.mjs so the generated URLs include it.",
      "sveltekit": "Built files are served from /_app/immutable/; for a sub-path or a CDN, check kit.paths.base and kit.paths.assets in svelte.config.js."
    },
    "verify": "curl -sI https://example.com/assets/app.3f9c2b.js | head -n 1 should print a 200 status line for each listed file, then re-run the audit.",
    "related": [
      "img-broken",
      "perf-render-blocking",
      "perf-mixed-content"
    ]
  },
  "perf-viewport-missing": {
    "summary": "These pages have no <meta name=\"viewport\"> tag, or one with an empty content. Mobile browsers then lay the page out at a desktop width and zoom out to fit, so text is tiny and visitors have to pinch to read.",
    "failing": {
      "label": "Head without a viewport tag",
      "lang": "html",
      "code": "<head>\n  <meta charset=\"utf-8\">\n  <title>Opening hours | Example Bakery</title>\n  <link rel=\"stylesheet\" href=\"/css/site.css\">\n</head>"
    },
    "measured": "On every page that answered 2xx, Septune looks for a <meta> tag with name=\"viewport\" anywhere in the HTML and reads its content attribute. The page is reported when there's no such tag or its content is empty. Attributes are read only when their values are in quotes, so a minified <meta name=viewport ...> without quotes is missed and the page reported.",
    "consequence": "The page fails on phones even when its CSS is responsive, because media queries see the desktop-sized layout width instead of the phone's. Google indexes pages as its smartphone crawler renders them, so that zoomed-out version is the one it evaluates.",
    "fix": "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head> of the layout every page shares. Leave out maximum-scale=1 and user-scalable=no, which stop visitors from zooming. If the tag is there but minified without quotes, have the minifier keep the quotes on that attribute.",
    "frameworks": {
      "nextjs": "The App Router adds the tag on its own and takes custom values from export const viewport in app/layout.tsx; on the Pages Router, add it with next/head in pages/_app.tsx.",
      "nuxt": "Nuxt sends width=device-width, initial-scale=1 by default; to set it explicitly, use app.head.viewport in nuxt.config.ts.",
      "astro": "Astro adds no head tags of its own, so put the tag in the <head> of the layout component all pages use.",
      "sveltekit": "The tag lives in src/app.html, which the default template ships with; put it back there if it was removed."
    },
    "verify": "curl -s https://example.com/ | grep -ic '<meta[^>]*name=\"viewport\"' should print 1, and the tag's content should read width=device-width, initial-scale=1, then re-run the audit.",
    "related": [
      "perf-viewport-no-width",
      "perf-core-web-vitals"
    ]
  },
  "perf-viewport-no-width": {
    "summary": "These pages have a viewport tag whose content sets no width, for example only initial-scale=1 or user-scalable=no. The layout width is then left to each browser to work out from the other values, and with neither width nor initial-scale it falls back to the desktop default.",
    "failing": {
      "label": "Viewport tag with a scale but no width",
      "lang": "html",
      "code": "<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"initial-scale=1, maximum-scale=1\">\n  <title>Menu | Example Bakery</title>\n</head>"
    },
    "measured": "On every page that answered 2xx with a viewport tag whose content isn't empty, Septune checks that content for a width= key, case-insensitive. Pages without one are listed, with the content found in the note. Any width value passes, including a fixed one such as width=1024, and when a page has several viewport tags only the first is read.",
    "consequence": "A page with initial-scale but no width depends on each browser's own rule for deriving the layout width, and one with neither is shown zoomed out at desktop width, as if it had no viewport tag. In both cases, media queries written for phones may not match.",
    "fix": "Put width=device-width first in the content: <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">. A fixed width such as width=1024 passes this check but still forces a desktop layout on phones, so replace it with device-width too. Remove maximum-scale and user-scalable=no while you're there, so visitors can zoom.",
    "frameworks": {
      "nextjs": "Make the viewport export in app/layout.tsx include width: \"device-width\", as in export const viewport: Viewport = { width: \"device-width\", initialScale: 1 }.",
      "nuxt": "Start app.head.viewport in nuxt.config.ts with width=device-width, and check that no useHead call replaces it with a shorter value.",
      "sveltekit": "Edit the viewport tag in src/app.html, where SvelteKit's template defines it for every page."
    },
    "verify": "Search the page source for the tag: curl -s https://example.com/menu | grep -io '<meta[^>]*name=\"viewport\"[^>]*>' should show a content that starts with width=device-width, then re-run the audit.",
    "related": [
      "perf-viewport-missing",
      "perf-core-web-vitals"
    ]
  },
  "framework-sitemap-missing": {
    "summary": "Septune couldn't read a sitemap for the site. Search engines then find your URLs only by following links, so a page nothing links to may never be discovered.",
    "failing": {
      "label": "GET /sitemap.xml on a single-page app",
      "lang": "http",
      "code": "HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\n\n<!doctype html>\n<html><head><title>Example</title></head>\n<body><div id=\"root\"></div></body></html>"
    },
    "measured": "When robots.txt has Sitemap: lines, Septune reads only those URLs; otherwise it tries /sitemap.xml, then /sitemap_index.xml, then /sitemap-index.xml. A file counts when it answers 2xx after redirects, isn't served as text/html, and has a <urlset> or <sitemapindex> root or at least one <loc>; gzip files are inflated first. The rule fires when no file passes, and a declared file that fails is also reported under indexing-sitemap-format.",
    "consequence": "New pages and pages deep in the site are found later, through links only. Septune also has no URL list to seed its crawl with, so it can't reach pages nothing links to or compare that list with the crawl.",
    "fix": "Generate the file at build time from your routes or content so it can't drift, list only canonical URLs that answer 200, and serve it as application/xml. Past 50,000 URLs or 50 MB uncompressed, split it into several files under a sitemap index. If it lives at another path, add a Sitemap: line with its full URL to robots.txt.",
    "frameworks": {
      "nextjs": "An app/sitemap.ts whose default export returns MetadataRoute.Sitemap is served at /sitemap.xml with an XML content type.",
      "nuxt": "A server/routes/sitemap.xml.ts handler should set the type explicitly with setHeader(event, 'content-type', 'application/xml'), because a file served as text/html is rejected as an app page.",
      "astro": "@astrojs/sitemap writes sitemap-index.xml and sitemap-0.xml, never sitemap.xml, and only when site is set in astro.config.mjs. Google learns of the index from a Sitemap: line in public/robots.txt or a submission in Search Console.",
      "sveltekit": "A GET handler in src/routes/sitemap.xml/+server.ts must return a Response with Content-Type application/xml; for a fixed set of pages, a file in static/ works too."
    },
    "verify": "Run curl -sI https://example.com/sitemap.xml and check for a 200 status with an XML Content-Type rather than text/html, then re-run the audit.",
    "related": [
      "indexing-sitemap-format",
      "framework-robots-no-sitemap",
      "indexing-sitemap-gaps"
    ]
  },
  "framework-robots-missing": {
    "summary": "The site has no usable robots.txt at its root. Google treats a missing file as permission to crawl everything, so nothing gets blocked by accident; what you lose is the standard place to declare the sitemap and to keep crawlers out of sections such as internal search.",
    "failing": {
      "label": "GET /robots.txt",
      "lang": "http",
      "code": "HTTP/1.1 404 Not Found\nContent-Type: text/plain; charset=utf-8\n\nNot Found"
    },
    "measured": "Septune requests /robots.txt on the start URL's origin, follows redirects, and waits up to 8 seconds. The file counts as missing when the final status isn't 2xx (404, 410, 5xx), when the request fails or times out, or when the answer is served as text/html. A 5xx or 429 is also reported under indexing-robots-unavailable, and an HTML answer under indexing-robots-html.",
    "consequence": "Crawlers get no rules and no Sitemap: line. A 5xx is the worse case, since Google then pauses crawling the site instead of crawling it freely.",
    "fix": "Serve a plain-text file at /robots.txt with at least one User-agent group and a Sitemap: line. Keep it static or generated at build time so it answers even when the app is down, and exclude it from any catch-all rewrite that sends every path to your app.",
    "frameworks": {
      "nextjs": "Add app/robots.ts returning MetadataRoute.Robots, or a static app/robots.txt; either is served at /robots.txt.",
      "nuxt": "Put robots.txt in public/, which Nuxt serves at the site root.",
      "astro": "Put robots.txt in public/; Astro copies it unchanged to the root of the build output.",
      "sveltekit": "Put robots.txt in static/, which SvelteKit serves from the root."
    },
    "verify": "Run curl -sIL https://example.com/robots.txt: the last status should be 200 with Content-Type text/plain. Re-run the audit once it is.",
    "related": [
      "indexing-robots-html",
      "indexing-robots-unavailable",
      "framework-robots-no-sitemap"
    ]
  },
  "framework-robots-no-sitemap": {
    "summary": "Septune found a sitemap at a standard path and a working robots.txt, but robots.txt doesn't name it. A crawler you never gave the address to has to guess it, as Septune did.",
    "failing": {
      "label": "robots.txt whose only Sitemap line is commented out",
      "lang": "text",
      "code": "User-agent: *\nDisallow: /cart\nDisallow: /search\n\n# Sitemap: https://example.com/sitemap.xml"
    },
    "measured": "The rule needs three facts: /robots.txt answers 2xx as a non-HTML file, a sitemap was read at /sitemap.xml, /sitemap_index.xml or /sitemap-index.xml, and no line of robots.txt starts with Sitemap: (any letter case, spaces allowed). A commented-out line doesn't count. A relative value such as Sitemap: /sitemap.xml is accepted and resolved against the site's origin, so it clears this rule.",
    "consequence": "Search engines learn the file's address only if you submitted it in their own tools, such as Search Console or Bing Webmaster Tools; Google and Bing both read the robots.txt line without any account.",
    "fix": "Add a line with the sitemap's full URL, for example Sitemap: https://example.com/sitemap.xml, anywhere in the file. Google requires an absolute URL there, so don't rely on a relative path even though Septune accepts one. The generated patch adds only that line and leaves the rules already in the file as they are.",
    "frameworks": {
      "nextjs": "Add a sitemap field, a string or an array of absolute URLs, to the object that app/robots.ts returns."
    },
    "verify": "Run curl -s https://example.com/robots.txt | grep -i '^sitemap:' and check that it prints an absolute URL that opens the file; then re-run the audit.",
    "related": [
      "framework-sitemap-missing",
      "framework-robots-missing",
      "indexing-robots-format"
    ]
  },
  "framework-js-only-content": {
    "summary": "The HTML the server sends is an empty app element and a script. The text, headings and links exist only once JavaScript has run in the browser, so a crawler that doesn't run it receives a blank page.",
    "failing": {
      "label": "index.html of a Vite + React app, served for every route",
      "lang": "html",
      "code": "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <title>Acme</title>\n    <script type=\"module\" crossorigin src=\"/assets/index-B7xQ2c.js\"></script>\n    <link rel=\"stylesheet\" crossorigin href=\"/assets/index-Dk3f9a.css\">\n  </head>\n  <body>\n    <div id=\"root\"></div>\n  </body>\n</html>"
    },
    "measured": "Septune fetches each indexable page as SeptuneBot and reads the HTML without running JavaScript. The page is reported when three things hold: an element with the id root, app, __next, __nuxt or svelte (a div or main), or an <app-root> element, is empty; the page loads at least one script with a src attribute; and the body text, with scripts, styles and noscript left out, is under 50 words. A page whose mount element already holds rendered HTML passes, whatever its id.",
    "consequence": "Googlebot puts pages like these in a rendering queue and indexes what the scripts produce, later than plain HTML. Crawlers that don't render get nothing: when Vercel measured them in December 2024, none of the main AI crawlers, GPTBot and ClaudeBot among them, executed JavaScript. Until the scripts run, every route also shares the title and description written in index.html.",
    "fix": "Put the content in the HTML: prerender the public routes at build time, or render them on the server, and keep the client-only app for screens behind a login. Some hosts prerender for a list of verified crawlers only, as Lovable does for its older React + Vite apps; SeptuneBot isn't on such lists, so compare with what Google got in Search Console before changing anything.",
    "frameworks": {
      "nextjs": "The App Router has no mount element, so this rule fires on Pages Router sites whose page returns nothing on the server, often a mounted guard or dynamic(() => import(...), { ssr: false }) wrapped around the whole page.",
      "nuxt": "Nuxt renders on the server unless ssr: false is set in nuxt.config.ts or in a routeRules entry; the empty element is then <div id=\"__nuxt\">. Drop the flag on public routes, or prerender them with routeRules and prerender: true."
    },
    "verify": "Run curl -s https://example.com/ | sed -n '/<body/,/<\\/body>/p' and look for the page's text. If the body holds only the empty element and script tags, re-run the audit after the change; Search Console's URL Inspection shows the HTML Google rendered, which can differ from what other crawlers get.",
    "related": [
      "structure-thin-content",
      "meta-title-duplicate",
      "link-orphan-pages",
      "structure-h1-missing"
    ]
  }
} satisfies Record<string, RuleDoc>;
