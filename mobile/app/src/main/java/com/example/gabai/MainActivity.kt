package com.example.gabai

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
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

        webView.loadUrl(START_URL)
    }

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
