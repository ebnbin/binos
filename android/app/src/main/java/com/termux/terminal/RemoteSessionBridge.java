package com.termux.terminal;

// TerminalSession 只能启动本机进程。放在同一个包里，绕开进程，让它接远程的输出、交出键盘输入：
// 先装好模拟器（之后 TerminalView 只会调整大小，不会再启动进程），再把 pid 设成正数，键盘输入才会进入写队列
public final class RemoteSessionBridge {
    private RemoteSessionBridge() {}

    public static void attach(TerminalSession session, int columns, int rows, int cellWidth, int cellHeight) {
        session.mEmulator = new TerminalEmulator(session, columns, rows, cellWidth, cellHeight, 5000, session.mClient);
        session.mShellPid = Integer.MAX_VALUE;
    }

    // 远程的输出交给模拟器，在主线程调用
    public static void feed(TerminalSession session, byte[] data) {
        session.mEmulator.append(data, data.length);
        session.notifyScreenUpdate();
    }

    // 阻塞读取键盘输入；队列关闭后返回 -1
    public static int readInput(TerminalSession session, byte[] buffer) {
        return session.mTerminalToProcessIOQueue.read(buffer, true);
    }

    public static void close(TerminalSession session) {
        session.mTerminalToProcessIOQueue.close();
    }
}
