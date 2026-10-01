// Kiem tra logic phien ban bang CACH CHAY THAT code Java (khong transpile).
//
// Cach nay dung hon bien Java sang JS roi so sanh: bien mat nghia thi ca hai
// deu sai ma test van xanh.
//
// Bien thuc trong UpdateChecker.parseVersion -> tinh ra versionCode cho tung
// ten phien ban -> doi chieu VOI cong thuc trong build-apk.ps1.
// Neu hai ben lech, may POS se so sanh sai va khong bao gio nhan ban moi.
import java.lang.reflect.Method;

public class VersionCheck {

    public static void main(String[] args) throws Exception {
        Class<?> c = Class.forName("com.milano.pos259.UpdateChecker");
        Method m = c.getDeclaredMethod("parseVersion", String.class);
        m.setAccessible(true);

        String[] names = {
            "1.0.0", "1.0.1", "1.0.9", "1.0.10", "1.1.0", "1.2.3", "1.9.9",
            "1.10.0", "2.0.0", "0.9.9", "10.0.0", "v1.0.1", "V1.2.3",
            "abc", "", "1.0.0-beta", "v"
        };
        for (String n : names) {
            Object r = m.invoke(null, n);
            System.out.println(n + " " + r);
        }

        System.out.println("--- SO SANH ---");
        String[][] pairs = {
            {"1.0.1", "1.0.0", "1"},   // truoc day KHONG duoc nhan
            {"1.1.0", "1.0.9", "1"},
            {"1.0.10", "1.0.9", "1"},   // so 10 > 9, khong phai so chuoi
            {"2.0.0", "1.9.9", "1"},
            {"1.0.0", "1.0.0", "0"},
            {"1.0.0", "1.0.1", "-1"}
        };
        for (String[] p : pairs) {
            int a = ((Integer) m.invoke(null, p[0])).intValue();
            int b = ((Integer) m.invoke(null, p[1])).intValue();
            String r = (a > b) ? "1" : (a < b ? "-1" : "0");
            System.out.println("CMP " + p[0] + " " + p[1] + " " + r + " " + p[2]);
        }

        System.out.println("--- MAY CO BAO HOP THOAI KHONG ---");
        String device = "1.0.0";
        String[][] rel = {
            {"1.0.1", "yes"}, {"1.1.0", "yes"}, {"2.0.0", "yes"},
            {"1.0.0", "no"}, {"0.9.0", "no"}
        };
        for (String[] r : rel) {
            int latest = ((Integer) m.invoke(null, r[0])).intValue();
            int mine = ((Integer) m.invoke(null, device)).intValue();
            System.out.println("PROMPT " + device + " " + r[0] + " " + (latest > mine ? "yes" : "no") + " " + r[1]);
        }
    }
}