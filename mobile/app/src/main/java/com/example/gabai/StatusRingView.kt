package com.example.gabai

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/**
 * A coloured stroke around the front camera's punch hole, used as a brief online-status light
 * (green online, yellow idle, red offline). It draws over the status bar area and never takes touches.
 */
@SuppressLint("ViewConstructor")
class StatusRingView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * density
    }

    /** The punch hole, in window coordinates. */
    var hole: RectF? = null
        set(value) {
            field = value
            invalidate()
        }

    var color: Int = 0
        set(value) {
            field = value
            paint.color = value
            invalidate()
        }

    init {
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onDraw(canvas: Canvas) {
        val r = hole ?: return
        // Cutout bounds hug the lens; sit the ring just outside it.
        val radius = minOf(r.width(), r.height()) / 2f + 2f * density + paint.strokeWidth / 2f
        canvas.drawCircle(r.centerX(), r.centerY(), radius, paint)
    }
}
