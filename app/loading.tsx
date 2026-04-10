export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
        <p className="text-xs text-gray-500 tracking-widest uppercase">Loading</p>
      </div>
    </div>
  );
}
