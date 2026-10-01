package com.example.gabai

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * Hosts the GabAI web app (built from ../web into assets/www) in a full-screen WebView
 * and bridges the pieces a browser page can't do alone: camera permission, the photo
 * picker, the back gesture, sharing exports and printing PDFs.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraRequest: PermissionRequest? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    // The system photo picker hands over only the photo the teacher chooses: no storage permission needed.
    private val pickImage = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileCallback = null
    }

    private val requestCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingCameraRequest?.let {
            if (granted) it.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else it.deny()
        }
        pendingCameraRequest = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        root = FrameLayout(this)
        webView = WebView(this)
        root.addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)
        // Until the page reports its theme, start from the last one it chose (or the system's).
        val systemDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        themeDark = getPreferences(MODE_PRIVATE).getBoolean(PREF_DARK, systemDark)
        setDarkChrome(themeDark)

        // Edge-to-edge: keep the page clear of the status bar, navigation bar, cutout and keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            hole = insets.displayCutout?.boundingRects?.let { pickPunchHole(it, view.width) }
            WindowInsetsCompat.CONSUMED
        }

        configureWebView()

        // Let the web app pop its own screen stack first; fall back to the system default.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.gabaiBack ? window.gabaiBack() : false") { handled ->
                    if (handled != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        handleAuthLink(intent)
        webView.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleAuthLink(intent)
    }

    private var pendingAuthEvent: String? = null

    /**
     * gabai://auth/confirmed, opened from the email-confirmation link. Supabase appends the outcome
     * to it, including sign-in tokens on success: only the outcome is kept and the tokens are dropped
     * unread, so the teacher still signs in with their password (and CAPTCHA, and two-step check).
     */
    private fun handleAuthLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "gabai" || uri.host != "auth") return
        val params = mutableMapOf<String, String>()
        for (part in listOfNotNull(uri.encodedQuery, uri.encodedFragment)) {
            for (pair in part.split('&')) {
                val i = pair.indexOf('=')
                if (i > 0) params[Uri.decode(pair.substring(0, i))] = Uri.decode(pair.substring(i + 1).replace('+', ' '))
            }
        }
        val error = params["error_code"] ?: params["error"]
        val event = JSONObject()
            .put("kind", if (error == null) "confirmed" else if (error == "otp_expired") "expired" else "error")
            .apply { params["error_description"]?.let { put("message", it.take(200)) } }
            .toString()
        synchronized(this) { pendingAuthEvent = event }
        // Don't keep the tokens around, and don't replay the link if the activity is recreated.
        intent.data = null
        setIntent(intent)
        // A running page picks it up now; a page still loading asks for it once it starts.
        if (::webView.isInitialized) webView.evaluateJavascript("window.gabaiAuthEvent && window.gabaiAuthEvent()", null)
    }

    /** Hands the last confirmation-link outcome to the page once (JSON), or null. */
    @Synchronized
    fun takeAuthEvent(): String? = pendingAuthEvent.also { pendingAuthEvent = null }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // The page is served over https; debug builds may talk to an http dev server on the host.
            mixedContentMode =
                if (debuggable) WebSettings.MIXED_CONTENT_ALWAYS_ALLOW else WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        // Cloudflare Turnstile (the sign-in CAPTCHA) runs in a challenges.cloudflare.com frame and
        // fails in a retry loop unless that frame may keep cookies. Android blocks them by default.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
        webView.setBackgroundColor(if (themeDark) DARK_CANVAS else CANVAS)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.addJavascriptInterface(NativeBridge(this), "GabAINative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Embedded frames (the CAPTCHA widget) load in place; the bridge is only on the main frame.
                if (request.url.host == APP_HOST || !request.isForMainFrame) return false
                // Anything off-app opens in the browser so the bridge is never exposed to it.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
                if (!wantsCamera || request.origin.host != APP_HOST) {
                    request.deny()
                    return
                }
                val granted = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
                if (granted) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    pendingCameraRequest?.deny()
                    pendingCameraRequest = request
                    requestCamera.launch(Manifest.permission.CAMERA)
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingCameraRequest == request) pendingCameraRequest = null
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    private var themeDark = false

    /** The front camera's punch hole (window coordinates), when the screen has one. */
    @Volatile
    private var hole: RectF? = null
    private var ring: StatusRingView? = null
    private var ringPulse: ObjectAnimator? = null
    private val ringHandler = Handler(Looper.getMainLooper())

    /** A punch hole is small and roughly round and near the top; a wide notch gets no ring. */
    private fun pickPunchHole(rects: List<android.graphics.Rect>, width: Int): RectF? =
        rects
            .filter { it.width() > 0 && it.width() < maxOf(width, 1) / 5 && it.width() <= it.height() * 2 && it.top < it.height() * 4 }
            .minByOrNull { it.width() * it.height() }
            ?.let { RectF(it) }

    /** Centre of the punch hole in the page's CSS pixels, for placing the status island under it. */
    fun cutoutJson(): String {
        val h = hole ?: return "{}"
        val density = resources.displayMetrics.density
        return JSONObject().put("x", (h.centerX() - root.paddingLeft) / density).toString()
    }

    /** Rings the punch hole in [color] for [durationMs], pulsing while reconnecting. */
    fun showStatusRing(color: String, pulse: Boolean, durationMs: Long) {
        val h = hole ?: return
        val parsed = runCatching { Color.parseColor(color) }.getOrNull() ?: return
        val view = ring ?: StatusRingView(this).also {
            (window.decorView as ViewGroup).addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            ring = it
        }
        view.hole = h
        view.color = parsed
        ringPulse?.cancel()
        view.animate().cancel()
        view.visibility = View.VISIBLE
        view.alpha = 0f
        view.animate().alpha(1f).setDuration(180).start()
        if (pulse) {
            ringPulse = ObjectAnimator.ofFloat(view, View.ALPHA, 1f, 0.2f).apply {
                duration = 450
                startDelay = 180
                repeatMode = ValueAnimator.REVERSE
                repeatCount = ValueAnimator.INFINITE
                start()
            }
        }
        ringHandler.removeCallbacksAndMessages(null)
        ringHandler.postDelayed({
            ringPulse?.cancel()
            view.animate().alpha(0f).setDuration(320).withEndAction { view.visibility = View.GONE }.start()
        }, durationMs.coerceIn(500, 10_000))
    }

    /** Matches the system bars to the page: dark for the camera viewfinder and the dark theme. */
    fun setDarkChrome(dark: Boolean) {
        root.setBackgroundColor(if (dark) DARK_CANVAS else CANVAS)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    /** The page's light/dark theme: applied now and remembered for the next launch. */
    fun setThemeChrome(dark: Boolean) {
        themeDark = dark
        getPreferences(MODE_PRIVATE).edit().putBoolean(PREF_DARK, dark).apply()
        webView.setBackgroundColor(if (dark) DARK_CANVAS else CANVAS)
        setDarkChrome(dark)
    }

    override fun onDestroy() {
        ringHandler.removeCallbacksAndMessages(null)
        ringPulse?.cancel()
        root.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
        const val START_URL = "https://$APP_HOST/assets/www/index.html"
        private const val PREF_DARK = "theme_dark"
        private val CANVAS = Color.parseColor("#F8F9FA")
        private val DARK_CANVAS = Color.parseColor("#121417")
    }
}
