package demo.app;

import demo.core.Greeter;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Uses the sibling module (reactor) and a main resource (resources:resources). */
public final class App {
  private App() {}

  public static String greeting() throws IOException {
    try (InputStream in = App.class.getResourceAsStream("/application.yml")) {
      if (in == null) {
        throw new IOException("application.yml not on the classpath");
      }
      String yml = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      for (String line : yml.split("\n")) {
        String trimmed = line.trim();
        if (trimmed.startsWith("target:")) {
          return Greeter.greet(trimmed.substring("target:".length()).trim());
        }
      }
      throw new IOException("greeting.target missing in application.yml");
    }
  }
}
