export type Pose =
  | "idle" | "sit" | "wave" | "laptop" | "idea" | "checklist" | "happy" | "search" | "chat"
  | "shield" | "cheer" | "jump" | "coin" | "calc" | "book" | "growth" | "headphones" | "umbrella" | "scope";

/** Mo the otter. Each pose is a separate picture; changing `pose` re-mounts the image so it pops in. */
export function Mascot({ pose, className = "", alt = "" }: { pose: Pose; className?: string; alt?: string }) {
  return <img key={pose} className={"mascot " + className} src={`/mascot/${pose}.webp`} alt={alt} draggable={false} decoding="async" />;
}
