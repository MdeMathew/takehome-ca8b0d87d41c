package es.workfactory.bookingsync;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * Reads .env from the project root, wherever you launch this from. Copy .env.example to .env
 * before starting.
 */
public final class Env {

    private static final Map<String, String> FILE = load();

    private Env() {}

    private static Map<String, String> load() {
        Map<String, String> values = new HashMap<>();
        Path directory = Path.of("").toAbsolutePath();
        for (int depth = 0; depth < 4 && directory != null; depth++, directory = directory.getParent()) {
            Path candidate = directory.resolve(".env");
            if (!Files.isRegularFile(candidate)) continue;
            try {
                for (String line : Files.readAllLines(candidate)) {
                    String trimmed = line.replace("\uFEFF", "").trim();
                    if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                    int at = trimmed.indexOf('=');
                    if (at < 0) continue;
                    values.put(trimmed.substring(0, at).trim(),
                            trimmed.substring(at + 1).trim().replaceAll("^[\"']|[\"']$", ""));
                }
            } catch (IOException ignored) {
            }
            break;
        }
        return values;
    }

    public static String required(String name) {
        String value = value(name);
        if (value == null || value.isBlank()) {
            System.err.println(name + " is missing. Copy .env.example to .env and fill it in.");
            System.exit(1);
        }
        return value;
    }

    public static String optional(String name, String fallback) {
        String value = value(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String value(String name) {
        // La propiedad del sistema va primero: es lo que el check cambia en caliente para
        // apuntar cada escenario a un mock distinto, algo que una variable de entorno de la JVM
        // no permite tras el arranque.
        String fromProperty = System.getProperty(name);
        if (fromProperty != null && !fromProperty.isBlank()) return fromProperty;
        String fromEnvironment = System.getenv(name);
        return fromEnvironment != null && !fromEnvironment.isBlank() ? fromEnvironment : FILE.get(name);
    }
}
