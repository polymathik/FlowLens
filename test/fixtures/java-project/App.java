/**
 * Simple Java fixture for testing.
 */
import java.util.List;
import java.util.ArrayList;

class Config {
    String name = "default";
    boolean debug = false;
}

class Service {
    Config config;

    Service(Config config) {
        this.config = config;
    }

    String getName() {
        return config.name;
    }

    List<String> items() {
        return new ArrayList<>();
    }
}
