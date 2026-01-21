package com.example.myapplication

import android.content.Context
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity

class MainActivity : ComponentActivity() {
    lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Create WebView programmatically
        webView = WebView(this)
        setContentView(webView)

        // Enable JS
        webView.settings.javaScriptEnabled = true

        // Make links stay in the WebView
        webView.webViewClient = WebViewClient()

        // Add JS -> Android bridge
        webView.addJavascriptInterface(
            AndroidBridge(this, webView),
            "Android"
        )

        // Load VaderJS dist index.html
        webView.loadUrl("file:///android_asset/myapp/index.html")
        WebView.setWebContentsDebuggingEnabled(true)

    }
}

// JS -> Android bridge
class AndroidBridge(
    private val context: Context,
    private val webView: WebView
) {

    @JavascriptInterface
    fun showToast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    @JavascriptInterface
    fun getDeviceName(): String {
        return android.os.Build.MODEL
    }



    @JavascriptInterface
    fun navigate(path: String?) {
        val cleanPath = when {
            path.isNullOrBlank() || path == "/" -> ""
            path.startsWith("/") -> path
            else -> "/$path"
        }

        webView.post {
            webView.loadUrl(
                "file:///android_asset/myapp$cleanPath/index.html"
            )
        }
    }

}

