package app.binos.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.withStyle

// 简单的代码高亮：注释、字符串、数字、常见关键字，不做语法分析

data class HighlightColors(val keyword: Color, val string: Color, val comment: Color, val number: Color)

@Composable
fun highlightColors() = HighlightColors(
    keyword = MaterialTheme.colorScheme.primary,
    string = MaterialTheme.colorScheme.tertiary,
    comment = MaterialTheme.colorScheme.outline,
    number = MaterialTheme.colorScheme.secondary,
)

private val keywords = setOf(
    "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "data", "def", "default", "defer", "del",
    "do", "elif", "else", "enum", "export", "extends", "false", "final", "finally", "fn", "for", "from", "fun", "func", "function", "go",
    "if", "impl", "implements", "import", "in", "interface", "is", "let", "match", "mod", "new", "nil", "None", "not", "null", "object",
    "override", "package", "private", "protected", "pub", "public", "raise", "return", "sealed", "self", "static", "struct", "super",
    "switch", "this", "throw", "throws", "trait", "True", "False", "true", "try", "type", "typeof", "undefined", "use", "val", "var",
    "void", "when", "where", "while", "with", "yield", "echo", "then", "fi", "done", "esac", "local", "readonly", "export",
)

private val hashComments = setOf("sh", "bash", "zsh", "shell", "console", "python", "py", "ruby", "rb", "yaml", "yml", "toml", "make", "makefile", "dockerfile", "r", "perl", "conf", "ini")
private val noHighlight = setOf("", "text", "txt", "plain", "markdown", "md", "diff", "tex", "latex", "math", "log", "output")

// 文件名到语言：只用来决定注释符号
fun languageOf(path: String): String = path.substringAfterLast('/').substringAfterLast('.', "").lowercase()

fun highlight(code: String, lang: String, colors: HighlightColors): AnnotatedString {
    val language = lang.lowercase()
    if (language in noHighlight || code.length > 60_000) return AnnotatedString(code)
    val hash = language in hashComments
    return buildAnnotatedString {
        var i = 0
        val n = code.length
        while (i < n) {
            val c = code[i]
            val start = i
            when {
                hash && c == '#' || !hash && c == '/' && i + 1 < n && code[i + 1] == '/' || language == "sql" && c == '-' && i + 1 < n && code[i + 1] == '-' -> {
                    while (i < n && code[i] != '\n') i++
                    withStyle(SpanStyle(color = colors.comment, fontStyle = FontStyle.Italic)) { append(code, start, i) }
                }
                !hash && c == '/' && i + 1 < n && code[i + 1] == '*' -> {
                    val end = code.indexOf("*/", i + 2)
                    i = if (end < 0) n else end + 2
                    withStyle(SpanStyle(color = colors.comment, fontStyle = FontStyle.Italic)) { append(code, start, i) }
                }
                c == '"' || c == '\'' || c == '`' -> {
                    i++
                    while (i < n && code[i] != c && !(code[i] == '\n' && c != '`')) {
                        if (code[i] == '\\') i++
                        i++
                    }
                    i = minOf(i + 1, n)
                    withStyle(SpanStyle(color = colors.string)) { append(code, start, i) }
                }
                c.isDigit() && (i == 0 || !code[i - 1].isLetterOrDigit() && code[i - 1] != '_') -> {
                    while (i < n && (code[i].isLetterOrDigit() || code[i] == '.' || code[i] == '_')) i++
                    withStyle(SpanStyle(color = colors.number)) { append(code, start, i) }
                }
                c.isLetter() || c == '_' -> {
                    while (i < n && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    val word = code.substring(start, i)
                    if (word in keywords) withStyle(SpanStyle(color = colors.keyword)) { append(word) } else append(word)
                }
                else -> {
                    append(c)
                    i++
                }
            }
        }
    }
}
