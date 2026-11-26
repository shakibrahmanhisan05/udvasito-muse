import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme/tokens";

/**
 * CMP-Markdown (specs §1.3.5) — renders the restricted Markdown subset used
 * by team content (legal, learn, dengue): ##/### headings, paragraphs,
 * bullet and numbered lists, **bold**, *italic*, links. No raw HTML.
 * Input is the block list produced by scripts/build-content.ts.
 */
export type MarkdownBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Splits **bold**, *italic* and [label](url) into styled spans.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={key} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <Text key={key} style={styles.italic}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <Text
          key={key}
          style={styles.link}
          accessibilityRole="link"
          onPress={() => void Linking.openURL(link[2])}
        >
          {link[1]}
        </Text>
      );
    }
    return <Text key={key}>{part}</Text>;
  });
}

export function Markdown(props: { blocks: MarkdownBlock[] }) {
  return (
    <View style={styles.wrap}>
      {props.blocks.map((block, i) => {
        if (block.type === "heading") {
          return (
            <Text key={i} accessibilityRole="header" style={block.level === 2 ? styles.h2 : styles.h3}>
              {block.text}
            </Text>
          );
        }
        if (block.type === "list") {
          return (
            <View key={i} style={styles.list}>
              {block.items.map((item, j) => (
                <Text key={j} style={styles.body}>
                  {block.ordered ? `${j + 1}. ` : "• "}
                  {renderInline(item, `${i}-${j}`)}
                </Text>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={styles.body}>
            {renderInline(block.text, `${i}`)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  h2: { ...typography.title, color: colors.text.primary },
  h3: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  link: { color: colors.status.info, textDecorationLine: "underline" },
  list: { gap: spacing.xs },
});
