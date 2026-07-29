export function Footer() {
  return (
    <footer className="border-t border-border/60 py-6 px-6 text-center">
      <p className="text-xs text-muted-foreground/70 tracking-wide">
        © {new Date().getFullYear()} جميع الحقوق محفوظة — تطوير وبرمجة{" "}
        <span className="text-muted-foreground font-medium">Nex Lazarus</span>
        {" & "}
        <span className="text-muted-foreground font-medium">Hex Lazarus</span>
      </p>
    </footer>
  );
}
