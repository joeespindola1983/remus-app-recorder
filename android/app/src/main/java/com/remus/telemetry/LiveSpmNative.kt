package com.remus.telemetry

internal object LiveSpmNative {
    init { System.loadLibrary("appmodules") }
    external fun create(): Long
    external fun destroy(handle: Long)
    external fun reset(handle: Long)
    external fun push(handle: Long, timestamp: Double, x: Double, y: Double, z: Double): DoubleArray?
}
