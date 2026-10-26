import subprocess
import sys
import os
import time

def main():
    print("=== 🚀 開始本機一鍵啟動專案（不使用 Docker） ===")
    
    # 取得專案根目錄的絕對路徑
    base_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(base_dir, "backend")
    frontend_dir = os.path.join(base_dir, "frontend")
    
    processes = []
    
    try:
        # 1. 啟動後端 (FastAPI / Uvicorn)
        print("\n[1/2] 正在啟動後端 FastAPI (Port 8000)...")
        # 假設您使用的是虛擬環境，或是直接用 uvicorn
        # 如果有開虛擬環境，也可以寫成 "source venv/bin/activate && uvicorn main:app --reload --port 8000"
        backend_cmd = "uvicorn main:app --reload --port 8000"
        backend_process = subprocess.Popen(backend_cmd, shell=True, cwd=backend_dir)
        processes.append(backend_process)
        
        # 稍等 1 秒讓後端先起步
        time.sleep(1)
        
        # 2. 啟動前端 (Next.js / npm run dev)
        print("\n[2/2] 正在啟動前端 Next.js (Port 3000)...")
        frontend_cmd = "npm run dev"
        frontend_process = subprocess.Popen(frontend_cmd, shell=True, cwd=frontend_dir)
        processes.append(frontend_process)
        
        print("\n=== ✨ 前後端服務已全部在本機啟動！ ===")
        print("🔗 前端網頁網址: http://127.0.0.1:3000")
        print("🔗 後端 API 文件: http://127.0.0.1:8000/docs")
        print("\n💡 提示：請保持此終端機視窗開啟。若要隨時停止所有服務，請在此視窗按下 Ctrl + C\n")
        
        # 讓主腳本持續運行並監控子行程
        for p in processes:
            p.wait()
            
    except KeyboardInterrupt:
        print("\n\n=== 🛑 偵測到中斷訊號，正在安全關閉所有服務... ===")
        for p in processes:
            p.terminate() # 終止程序
            p.wait()
        print("=== ✅ 所有服務已安全關閉，掰掰！ ===")
        sys.exit(0)

if __name__ == "__main__":
    main()