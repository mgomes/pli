use topcoat::{
    Result,
    router::page,
    view::{View, component, view},
};

#[component]
async fn document() -> Result<impl View> {
    Ok(view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta name="theme-color" content="#0b0a09">
                <title>"pli · Home cinema"</title>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
                <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
                <link rel="stylesheet" href="/static/app.css">
                <script defer="" src="/static/icons.js"></script>
                <script type="module" src="/static/app.js"></script>
            </head>
            <body>
                <a href="#content" class="skip-link">"Skip to library"</a>
                <header class="cinema-nav">
                    <div class="nav-inner">
                        <a href="/" class="brand" aria-label="pli home">
                            <span class="brand-name">"pli"</span>
                            <span class="brand-caption">"HOME CINEMA"</span>
                        </a>
                        <nav id="section-nav" class="nav" aria-label="Library">
                            <button class="nav-item" data-section="recently-added">"Recently Added"</button>
                            <button class="nav-item" data-section="movies">"Movies"</button>
                            <button class="nav-item" data-section="tv">"TV Shows"</button>
                        </nav>
                        <div class="nav-tools">
                            <div class="search-wrapper">
                                <i data-lucide="search" class="search-icon"></i>
                                <input type="search" id="search-input" class="search-input" placeholder="Search films, series, people" aria-label="Search library" autocomplete="off">
                                <kbd>"/"</kbd>
                            </div>
                            <button class="settings-nav" data-section="settings" aria-label="Settings" title="Settings"><i data-lucide="settings"></i></button>
                        </div>
                    </div>
                </header>
                <main class="main">
                    <header class="topbar">
                        <div>
                            <div id="section-eyebrow" class="eyebrow">"YOUR LIBRARY"</div>
                            <h1 id="section-title">"Recently Added"</h1>
                            <p class="topbar-desc" id="section-description">"Your next great watch is waiting."</p>
                        </div>
                        <span id="library-count" class="mono"></span>
                    </header>
                    <section id="content" class="content" aria-label="Library content" tabindex="-1">
                        <div class="empty-state" role="status">"Opening your library…"</div>
                    </section>
                </main>
                <div id="notification" class="notification" role="status" aria-live="polite" hidden=""></div>
                <noscript><p>"Enable JavaScript to browse and play your Plex library."</p></noscript>
            </body>
        </html>
    })
}

#[page("/")]
pub(crate) async fn home() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/recently-added")]
pub(crate) async fn recent() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/movies")]
pub(crate) async fn movies() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/movies/{media_id}")]
pub(crate) async fn movie() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/tv")]
pub(crate) async fn tv() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/tv/{media_id}")]
pub(crate) async fn show() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/tv/{media_id}/season/{season_id}")]
pub(crate) async fn season() -> Result<impl View> {
    Ok(view! { document() })
}
#[page("/settings")]
pub(crate) async fn settings() -> Result<impl View> {
    Ok(view! { document() })
}
