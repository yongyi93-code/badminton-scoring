/*
 * 这个文件是生成出来的，别手改 —— 见 design/make-qr.py。
 *
 * 内容是 https://rallybadminton.com 的二维码，纠错等级 M（脏一点、糊一点还扫得出来，
 * 而这张图是要被转发、截图、再转发的）。
 *
 * 25×25 个格子，外加四格白边（没有白边很多手机扫不出来）。
 * viewBox 就用格子数，所以想画多大画多大，
 * 缩放不会糊 —— 位图二维码缩小之后扫不出来，正是这个原因。
 */
export function QrCode({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 33 33"
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="https://rallybadminton.com"
    >
      {/* 白底是必须的：二维码扫的是黑白对比，透明底压在深色卡片上就扫不出来 */}
      <rect width="33" height="33" fill="#fff" />
      <path d="M4 4h7v1h-7zM14 4h1v1h-1zM18 4h1v1h-1zM22 4h7v1h-7zM4 5h1v1h-1zM10 5h1v1h-1zM12 5h2v1h-2zM16 5h1v1h-1zM20 5h1v1h-1zM22 5h1v1h-1zM28 5h1v1h-1zM4 6h1v1h-1zM6 6h3v1h-3zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h3v1h-3zM18 6h3v1h-3zM22 6h1v1h-1zM24 6h3v1h-3zM28 6h1v1h-1zM4 7h1v1h-1zM6 7h3v1h-3zM10 7h1v1h-1zM12 7h1v1h-1zM17 7h1v1h-1zM19 7h2v1h-2zM22 7h1v1h-1zM24 7h3v1h-3zM28 7h1v1h-1zM4 8h1v1h-1zM6 8h3v1h-3zM10 8h1v1h-1zM14 8h1v1h-1zM17 8h1v1h-1zM20 8h1v1h-1zM22 8h1v1h-1zM24 8h3v1h-3zM28 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM17 9h2v1h-2zM22 9h1v1h-1zM28 9h1v1h-1zM4 10h7v1h-7zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h7v1h-7zM12 11h5v1h-5zM20 11h1v1h-1zM4 12h1v1h-1zM10 12h1v1h-1zM12 12h1v1h-1zM14 12h6v1h-6zM21 12h2v1h-2zM25 12h3v1h-3zM5 13h4v1h-4zM13 13h3v1h-3zM19 13h1v1h-1zM23 13h5v1h-5zM4 14h2v1h-2zM7 14h1v1h-1zM10 14h2v1h-2zM14 14h1v1h-1zM16 14h1v1h-1zM18 14h3v1h-3zM22 14h1v1h-1zM24 14h2v1h-2zM27 14h2v1h-2zM5 15h2v1h-2zM12 15h1v1h-1zM14 15h1v1h-1zM16 15h1v1h-1zM21 15h2v1h-2zM25 15h1v1h-1zM28 15h1v1h-1zM4 16h1v1h-1zM6 16h1v1h-1zM8 16h3v1h-3zM12 16h1v1h-1zM16 16h1v1h-1zM19 16h2v1h-2zM22 16h1v1h-1zM28 16h1v1h-1zM4 17h5v1h-5zM11 17h1v1h-1zM16 17h2v1h-2zM19 17h2v1h-2zM23 17h1v1h-1zM27 17h1v1h-1zM4 18h1v1h-1zM9 18h4v1h-4zM14 18h1v1h-1zM17 18h3v1h-3zM21 18h1v1h-1zM23 18h3v1h-3zM27 18h2v1h-2zM4 19h1v1h-1zM6 19h1v1h-1zM13 19h2v1h-2zM19 19h2v1h-2zM22 19h2v1h-2zM25 19h2v1h-2zM28 19h1v1h-1zM4 20h1v1h-1zM7 20h6v1h-6zM14 20h11v1h-11zM26 20h1v1h-1zM12 21h2v1h-2zM15 21h1v1h-1zM17 21h1v1h-1zM20 21h1v1h-1zM24 21h1v1h-1zM4 22h7v1h-7zM13 22h1v1h-1zM15 22h1v1h-1zM20 22h1v1h-1zM22 22h1v1h-1zM24 22h1v1h-1zM28 22h1v1h-1zM4 23h1v1h-1zM10 23h1v1h-1zM13 23h1v1h-1zM15 23h1v1h-1zM19 23h2v1h-2zM24 23h1v1h-1zM4 24h1v1h-1zM6 24h3v1h-3zM10 24h1v1h-1zM14 24h4v1h-4zM19 24h6v1h-6zM26 24h1v1h-1zM4 25h1v1h-1zM6 25h3v1h-3zM10 25h1v1h-1zM15 25h1v1h-1zM17 25h6v1h-6zM27 25h2v1h-2zM4 26h1v1h-1zM6 26h3v1h-3zM10 26h1v1h-1zM14 26h1v1h-1zM17 26h4v1h-4zM25 26h2v1h-2zM28 26h1v1h-1zM4 27h1v1h-1zM10 27h1v1h-1zM14 27h3v1h-3zM19 27h3v1h-3zM23 27h2v1h-2zM28 27h1v1h-1zM4 28h7v1h-7zM12 28h1v1h-1zM15 28h2v1h-2zM20 28h3v1h-3zM25 28h1v1h-1zM28 28h1v1h-1z" fill="#000" />
    </svg>
  )
}
