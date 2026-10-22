# backend/app/services/documents.py
# 文件解析與切片。先檢查檔案內容是否符合宣告的類型，再抽出純文字並切成適合向量化的片段。

# io.BytesIO 讓 pypdf 可以把記憶體中的位元組當成檔案讀取
import io

# pypdf 負責解析 PDF 內的文字
from pypdf import PdfReader

# 允許的副檔名與 MIME 類型對照表；只接受這三種
ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".md": "text/markdown",
    ".txt": "text/plain",
}

# 每個切片的字元上限
_CHUNK_SIZE = 800
# 相鄰切片重疊的字元數，避免句子被硬切斷後失去上下文
_CHUNK_OVERLAP = 100
# PDF 最多讀取的頁數，防止惡意超大檔案耗盡資源
_MAX_PDF_PAGES = 300
# 解析後文字的總長度上限，防止解壓縮炸彈式的膨脹
_MAX_TEXT_CHARS = 500_000


class DocumentError(Exception):
    # 文件本身不合法（類型、內容、大小）時使用的錯誤，訊息可安全顯示給使用者
    pass


def detect_mime(filename: str, data: bytes) -> str:
    # 取出副檔名（轉小寫），並確認它在允許清單內
    lowered = filename.lower()
    suffix = next((ext for ext in ALLOWED_TYPES if lowered.endswith(ext)), None)
    if suffix is None:
        raise DocumentError("只接受 PDF、Markdown 或 TXT 檔案")

    # PDF 必須以 %PDF- 開頭，檢查檔頭可以防止把其他檔案改名後上傳
    if suffix == ".pdf" and not data.startswith(b"%PDF-"):
        raise DocumentError("檔案內容不是有效的 PDF")

    # 文字檔必須能以 UTF-8 解碼，並且不能含有空位元組（常見於二進位檔）
    if suffix in (".md", ".txt"):
        if b"\x00" in data:
            raise DocumentError("文字檔含有非文字內容")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise DocumentError("文字檔必須是 UTF-8 編碼") from exc

    return ALLOWED_TYPES[suffix]


def extract_text(mime_type: str, data: bytes) -> str:
    # PDF 逐頁抽取文字
    if mime_type == "application/pdf":
        reader = PdfReader(io.BytesIO(data))
        # 頁數超過上限就拒絕，避免資源耗盡
        if len(reader.pages) > _MAX_PDF_PAGES:
            raise DocumentError(f"PDF 頁數超過 {_MAX_PDF_PAGES} 頁")
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages)
    else:
        # Markdown 與 TXT 直接以 UTF-8 解碼
        text = data.decode("utf-8")

    # 去除多餘空白行，讓切片更乾淨
    text = "\n".join(line.rstrip() for line in text.splitlines() if line.strip())
    if len(text) > _MAX_TEXT_CHARS:
        raise DocumentError("文件內容過長")
    if not text:
        raise DocumentError("文件中沒有可讀取的文字")
    return text


def chunk_text(text: str) -> list[str]:
    # 以固定視窗切片，相鄰切片有重疊區域
    chunks: list[str] = []
    step = _CHUNK_SIZE - _CHUNK_OVERLAP
    for start in range(0, len(text), step):
        piece = text[start:start + _CHUNK_SIZE].strip()
        if piece:
            chunks.append(piece)
        # 已經到達文字結尾就停止，避免產生只含重疊內容的尾端切片
        if start + _CHUNK_SIZE >= len(text):
            break
    return chunks
