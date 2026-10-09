package demo.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class AppTest {
  @Test
  void greetsFromMainResourceThroughSiblingModule() throws IOException {
    try (InputStream in = AppTest.class.getResourceAsStream("/expected.txt")) {
      assertNotNull(in, "src/test/resources must reach target/test-classes");
      String expected = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
      assertEquals(expected, App.greeting());
    }
  }
}
