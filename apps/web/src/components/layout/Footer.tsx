import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-surface-800/50 py-8 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">M</span>
            </div>
            <span className="text-surface-500 text-sm">
              © {new Date().getFullYear()} Multiplayer Games
            </span>
          </div>

          <div className="flex items-center gap-6 text-sm text-surface-500">
            <Link href="/about" className="hover:text-surface-300 transition-colors">
              About
            </Link>
            <Link href="/privacy" className="hover:text-surface-300 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-surface-300 transition-colors">
              Terms
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-surface-300 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

