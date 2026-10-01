package com.example.gabai

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/**
 * Exposed to the page as `window.GabAINative`. JavaScript calls arrive on a
 * background thread, so every method hops to the UI thread before touching views.
 */
class NativeBridge(private val activity: MainActivity) {

    // The print framework needs the WebView alive until the job has spooled.
    private var printView: WebView? = null

    /** Server settings baked in from local.properties; empty values mean a demo-only build. */
    @JavascriptInterface
    fun getConfig(): String =
        JSONObject()
            .put("apiBaseUrl", BuildConfig.API_BASE_URL)
            .put("supabaseUrl", BuildConfig.SUPABASE_URL)
            .put("supabasePublishableKey", BuildConfig.SUPABASE_PUBLISHABLE_KEY)
            .put("captchaSiteKey", BuildConfig.CAPTCHA_SITE_KEY)
            .toString()

    @JavascriptInterface
    fun shareFile(fileName: String, mimeType: String, content: String) {
        activity.runOnUiThread { share(fileName, mimeType, content) }
    }

    @JavascriptInterface
    fun printHtml(jobName: String, html: String) {
        activity.runOnUiThread { print(jobName, html) }
    }

    @JavascriptInterface
    fun setDarkChrome(dark: Boolean) {
        activity.runOnUiThread { activity.setDarkChrome(dark) }
    }

    @JavascriptInterface
    fun getCutout(): String = activity.cutoutJson()

    @JavascriptInterface
    fun setStatusRing(color: String, pulse: Boolean, durationMs: Int) {
        if (!Regex("#[0-9A-Fa-f]{6}").matches(color)) return
        activity.runOnUiThread { activity.showStatusRing(color, pulse, durationMs.toLong()) }
    }

    /** Text on the clipboard, for "Paste list" (WebView pages can't read the clipboard themselves). */
    @JavascriptInterface
    fun readClipboard(): String? {
        val clip = activity.getSystemService(ClipboardManager::class.java)?.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).coerceToText(activity)?.toString()?.take(100_000)
    }

    /** Outcome of the email-confirmation link that opened the app, if any (consumed on read). */
    @JavascriptInterface
    fun takeAuthEvent(): String? = activity.takeAuthEvent()

    @JavascriptInterface
    fun setTheme(dark: Boolean) {
        activity.runOnUiThread { activity.setThemeChrome(dark) }
    }

    private fun share(fileName: String, mimeType: String, content: String) {
        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifBlank { "gabai-export.txt" }
        val type = if (mimeType in SHAREABLE_TYPES) mimeType else "text/plain"
        try {
            val dir = File(activity.cacheDir, "exports").apply { mkdirs() }
            val file = File(dir, safeName).apply { writeText(content) }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                this.type = type
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, safeName)
                clipData = ClipData.newRawUri(safeName, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, "Share $safeName"))
        } catch (e: Exception) {
            Toast.makeText(activity, "Could not export $safeName", Toast.LENGTH_SHORT).show()
        }
    }

    private fun print(jobName: String, html: String) {
        val view = WebView(activity)
        var started = false
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String?) {
                if (started) return
                started = true
                val name = "GabAI - ${jobName.take(60)}"
                val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                manager.print(
                    name,
                    v.createPrintDocumentAdapter(name),
                    PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build(),
                )
            }
        }
        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
        printView = view
    }

    private companion object {
        val SHAREABLE_TYPES = setOf("text/csv", "text/markdown", "text/plain")
    }
}
